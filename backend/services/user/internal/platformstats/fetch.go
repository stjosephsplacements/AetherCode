package platformstats

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

var (
	skillrackProgramsRe    = regexp.MustCompile(`(?i)PROGRAMS SOLVED[\s\S]*?</i>([0-9,]+)`)
	skillrackProgramsAltRe = regexp.MustCompile(`(?i)programs?\s*solved[:\s]*([0-9,]+)`)
)

const userAgent = "AetherCode (+https://aethercode.stjosephsplacements.in)"

type FetchResult struct {
	Lines  []string
	Status string // fresh | stale
	Err    error
}

func Fetch(ctx context.Context, platform, handle string) FetchResult {
	lines, status, err := fetchLines(ctx, platform, handle)
	return FetchResult{Lines: lines, Status: status, Err: err}
}

func fetchLines(ctx context.Context, platform, handle string) ([]string, string, error) {
	platform = strings.ToLower(strings.TrimSpace(platform))
	handle = strings.TrimSpace(handle)
	if handle == "" {
		return nil, "failed", fmt.Errorf("handle is blank")
	}
	client := &http.Client{Timeout: 8 * time.Second}
	switch platform {
	case "codeforces":
		return codeforces(ctx, client, handle)
	case "github":
		return github(ctx, client, handle)
	case "leetcode":
		return leetcode(ctx, client, handle)
	case "atcoder":
		return atcoder(ctx, client, handle)
	case "codechef", "hackerrank":
		return nil, "fresh", nil
	case "skillrack":
		return skillrack(ctx, client, handle)
	default:
		return nil, "failed", fmt.Errorf("unsupported platform %s", platform)
	}
}

func getJSON(ctx context.Context, client *http.Client, url string, headers map[string]string) (map[string]any, int, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, 0, err
	}
	request.Header.Set("User-Agent", userAgent)
	request.Header.Set("Accept", "application/json")
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, 0, err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return nil, response.StatusCode, err
	}
	if response.StatusCode == http.StatusTooManyRequests {
		return nil, response.StatusCode, fmt.Errorf("rate limited")
	}
	if response.StatusCode >= 400 {
		return nil, response.StatusCode, fmt.Errorf("http %d", response.StatusCode)
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, response.StatusCode, err
	}
	return payload, response.StatusCode, nil
}

func staleOnRateLimit(err error) string {
	if err != nil && strings.Contains(strings.ToLower(err.Error()), "rate") {
		return "stale"
	}
	return "failed"
}

func codeforces(ctx context.Context, client *http.Client, handle string) ([]string, string, error) {
	payload, code, err := getJSON(ctx, client, "https://codeforces.com/api/user.info?handles="+encode(handle), nil)
	if err != nil {
		return nil, staleOnRateLimit(err), err
	}
	if status, _ := payload["status"].(string); status != "OK" {
		return nil, "failed", fmt.Errorf("codeforces status %v", payload["status"])
	}
	result, _ := payload["result"].([]any)
	if len(result) == 0 {
		return nil, "failed", fmt.Errorf("codeforces user missing")
	}
	user, _ := result[0].(map[string]any)
	lines := make([]string, 0, 2)
	if rating, ok := user["rating"].(float64); ok {
		maxRating, _ := user["maxRating"].(float64)
		lines = append(lines, fmt.Sprintf("Rating %.0f (max %.0f)", rating, maxRating))
	} else {
		lines = append(lines, "Unrated")
	}
	if rank, ok := user["rank"].(string); ok && rank != "" {
		lines = append(lines, "Rank "+rank)
	}
	_ = code
	return lines, "fresh", nil
}

func github(ctx context.Context, client *http.Client, handle string) ([]string, string, error) {
	payload, _, err := getJSON(ctx, client, "https://api.github.com/users/"+encode(handle), nil)
	if err != nil {
		return nil, staleOnRateLimit(err), err
	}
	repos, _ := payload["public_repos"].(float64)
	followers, _ := payload["followers"].(float64)
	return []string{
		fmt.Sprintf("%.0f public repositories", repos),
		fmt.Sprintf("%.0f followers", followers),
	}, "fresh", nil
}

func leetcode(ctx context.Context, client *http.Client, handle string) ([]string, string, error) {
	body := map[string]any{
		"query":     "query($username: String!) { matchedUser(username: $username) { submitStats { acSubmissionNum { difficulty count } } } }",
		"variables": map[string]any{"username": handle},
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, "failed", err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://leetcode.com/graphql", bytes.NewReader(encoded))
	if err != nil {
		return nil, "failed", err
	}
	request.Header.Set("User-Agent", userAgent)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Referer", "https://leetcode.com")
	response, err := client.Do(request)
	if err != nil {
		return nil, staleOnRateLimit(err), err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusTooManyRequests {
		return nil, "stale", fmt.Errorf("rate limited")
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return nil, "failed", err
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, "failed", err
	}
	data, _ := payload["data"].(map[string]any)
	user, _ := data["matchedUser"].(map[string]any)
	if user == nil {
		return nil, "failed", fmt.Errorf("leetcode user missing")
	}
	stats, _ := user["submitStats"].(map[string]any)
	ac, _ := stats["acSubmissionNum"].([]any)
	counts := map[string]int{}
	total := 0
	for _, entry := range ac {
		row, _ := entry.(map[string]any)
		difficulty, _ := row["difficulty"].(string)
		count, _ := row["count"].(float64)
		counts[strings.ToLower(difficulty)] = int(count)
		total += int(count)
	}
	return []string{
		fmt.Sprintf("%d solved", total),
		fmt.Sprintf("%d easy, %d medium, %d hard", counts["easy"], counts["medium"], counts["hard"]),
	}, "fresh", nil
}

func skillrack(ctx context.Context, client *http.Client, handle string) ([]string, string, error) {
	html, err := getHTML(ctx, client, "https://www.skillrack.com/faces/resume.xhtml?id="+encode(handle))
	if err != nil {
		return nil, staleOnRateLimit(err), err
	}
	lines := parseSkillrackProgramsSolved(html)
	if len(lines) == 0 {
		return nil, "fresh", nil
	}
	return lines, "fresh", nil
}

func parseSkillrackProgramsSolved(html string) []string {
	for _, pattern := range []*regexp.Regexp{skillrackProgramsRe, skillrackProgramsAltRe} {
		match := pattern.FindStringSubmatch(html)
		if len(match) > 1 && strings.TrimSpace(match[1]) != "" {
			return []string{strings.TrimSpace(match[1]) + " programs solved"}
		}
	}
	return nil
}

func getHTML(ctx context.Context, client *http.Client, url string) (string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	request.Header.Set("User-Agent", userAgent)
	request.Header.Set("Accept", "text/html")
	response, err := client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if response.StatusCode == http.StatusTooManyRequests {
		return "", fmt.Errorf("rate limited")
	}
	if response.StatusCode >= 400 {
		return "", fmt.Errorf("http %d", response.StatusCode)
	}
	return string(body), nil
}

func atcoder(ctx context.Context, client *http.Client, handle string) ([]string, string, error) {
	payload, _, err := getJSON(ctx, client, "https://kenkoooo.com/atcoder/atcoder-api/v3/user/ac_rank?user="+encode(handle), nil)
	if err != nil {
		return nil, staleOnRateLimit(err), err
	}
	count, _ := payload["count"].(float64)
	return []string{fmt.Sprintf("%.0f problems solved", count)}, "fresh", nil
}

func encode(value string) string {
	return strings.ReplaceAll(value, " ", "%20")
}

func statsJSON(lines []string) []byte {
	if len(lines) == 0 {
		return []byte("[]")
	}
	encoded, _ := json.Marshal(lines)
	return encoded
}

func failureText(err error) string {
	if err == nil {
		return ""
	}
	text := strings.TrimSpace(err.Error())
	if len(text) > 500 {
		text = text[:500]
	}
	return text
}

func backoffSeconds(platform string, failures int) time.Duration {
	base := 2
	if failures > 6 {
		failures = 6
	}
	delay := time.Duration(base<<failures) * time.Second
	if platform == "leetcode" {
		delay += 2 * time.Second
	}
	return delay
}
