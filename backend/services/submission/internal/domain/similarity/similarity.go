// Package similarity finds pairs of programs that share unusual code
// (MOSS-style winnowing, ported from the exam app's lib/similarity.ts). Code is
// reduced to a token stream that ignores names, literals, comments and layout;
// k-grams of tokens are hashed and a winnowed subset fingerprints each program.
// Pairs are scored by shared fingerprints, ignoring those most of the class
// shares (boilerplate and the obvious solution).
package similarity

import (
	"regexp"
	"sort"
	"strings"
)

const (
	gramTokens = 8
	window     = 4
	// minFingerprints: programs with fewer distinctive fingerprints are too
	// small to judge.
	minFingerprints = 6
)

var keywords = func() map[string]struct{} {
	set := map[string]struct{}{}
	for _, word := range strings.Fields(
		"auto break case char const continue default do double else enum extern float for goto if int long register return short signed sizeof static struct switch typedef union unsigned void volatile while " +
			"bool class delete false friend inline namespace new operator private protected public template this throw true try catch using virtual nullptr std cin cout endl vector string map set pair " +
			"abstract boolean byte extends final finally implements import instanceof interface native package super synchronized throws transient var null String System Scanner " +
			"and as assert async await def del elif except from global in is lambda nonlocal not or pass raise with yield None True False print input range len " +
			"func go chan defer select fmt const let function console require") {
		set[word] = struct{}{}
	}
	return set
}()

var (
	blockComment  = regexp.MustCompile(`(?s)/\*.*?\*/`)
	lineComment   = regexp.MustCompile(`//[^\n]*`)
	hashComment   = regexp.MustCompile(`(^|\s)#[^\n]*`)
	pythonStrings = regexp.MustCompile(`(?s)""".*?"""|'''.*?'''`)
	tokenPattern  = regexp.MustCompile(`("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\b\d[\w.]*)|([A-Za-z_]\w*)|(==|!=|<=|>=|&&|\|\||\+\+|--|<<|>>|->|::|\+=|-=|\*=|/=|[{}()\[\];,.<>+\-*/%=!&|^~?:])`)
)

// Tokenize reduces source to tokens: strings become S, numbers N, names V;
// keywords and operators stay as written.
func Tokenize(source string) []string {
	source = blockComment.ReplaceAllString(source, " ")
	source = lineComment.ReplaceAllString(source, " ")
	// Python comments and C preprocessor lines other than include/define/import.
	source = hashComment.ReplaceAllStringFunc(source, func(match string) string {
		trimmed := strings.TrimLeft(match, " \t\r\n")
		for _, directive := range []string{"#include", "#define", "#import"} {
			if strings.HasPrefix(trimmed, directive) {
				return match
			}
		}
		return " "
	})
	source = pythonStrings.ReplaceAllString(source, `""`)
	var tokens []string
	for _, match := range tokenPattern.FindAllStringSubmatch(source, -1) {
		switch {
		case match[1] != "":
			tokens = append(tokens, "S")
		case match[2] != "":
			tokens = append(tokens, "N")
		case match[3] != "":
			if _, keyword := keywords[match[3]]; keyword {
				tokens = append(tokens, match[3])
			} else {
				tokens = append(tokens, "V")
			}
		default:
			tokens = append(tokens, match[4])
		}
	}
	return tokens
}

// Fingerprints returns the winnowed hashes of a program's token k-grams.
func Fingerprints(source string) map[uint32]struct{} {
	tokens := Tokenize(source)
	var grams []uint32
	for start := 0; start+gramTokens <= len(tokens); start++ {
		grams = append(grams, fnv(strings.Join(tokens[start:start+gramTokens], " ")))
	}
	selected := map[uint32]struct{}{}
	if len(grams) <= window {
		for _, gram := range grams {
			selected[gram] = struct{}{}
		}
		return selected
	}
	// Sliding-window minimum with a monotonic deque of indices.
	var deque []int
	for index, gram := range grams {
		for len(deque) > 0 && grams[deque[len(deque)-1]] >= gram {
			deque = deque[:len(deque)-1]
		}
		deque = append(deque, index)
		if deque[0] <= index-window {
			deque = deque[1:]
		}
		if index >= window-1 {
			selected[grams[deque[0]]] = struct{}{}
		}
	}
	return selected
}

func fnv(text string) uint32 {
	hash := uint32(2166136261)
	for index := 0; index < len(text); index++ {
		hash = (hash ^ uint32(text[index])) * 16777619
	}
	return hash
}

// Program is one student's code for one question.
type Program struct {
	ID     string
	Source string
}

// Pair is two programs that share unusual code. Score is the shared
// fingerprints over the smaller program's distinctive fingerprints (0 to 1).
type Pair struct {
	A, B   string
	Score  float64
	Shared int
}

// Pairs returns pairs scoring at least threshold, most similar first. A
// fingerprint held by more than commonFraction of the programs (at least 2,
// at most 50 programs) is ignored.
func Pairs(programs []Program, threshold, commonFraction float64) []Pair {
	holders := map[uint32][]string{}
	for _, program := range programs {
		for print := range Fingerprints(program.Source) {
			holders[print] = append(holders[print], program.ID)
		}
	}
	commonLimit := max(2, min(50, int(float64(len(programs))*commonFraction)))
	distinctive := map[string]int{}
	type key struct{ a, b string }
	shared := map[key]int{}
	for _, ids := range holders {
		if len(ids) > commonLimit {
			continue
		}
		for _, id := range ids {
			distinctive[id]++
		}
		for left := range ids {
			for right := left + 1; right < len(ids); right++ {
				a, b := ids[left], ids[right]
				if b < a {
					a, b = b, a
				}
				shared[key{a, b}]++
			}
		}
	}
	var pairs []Pair
	for pair, count := range shared {
		smaller := min(distinctive[pair.a], distinctive[pair.b])
		if smaller < minFingerprints {
			continue
		}
		if score := float64(count) / float64(smaller); score >= threshold {
			pairs = append(pairs, Pair{A: pair.a, B: pair.b, Score: score, Shared: count})
		}
	}
	sort.Slice(pairs, func(left, right int) bool {
		if pairs[left].Score != pairs[right].Score {
			return pairs[left].Score > pairs[right].Score
		}
		if pairs[left].Shared != pairs[right].Shared {
			return pairs[left].Shared > pairs[right].Shared
		}
		return pairs[left].A+pairs[left].B < pairs[right].A+pairs[right].B
	})
	return pairs
}
