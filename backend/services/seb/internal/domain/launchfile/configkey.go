package launchfile

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
)

// ConfigKey is the SEB Config Key of the file Build produces for settings:
// SHA-256 of the settings as SEB-JSON (keys sorted case-insensitively, compact,
// empty dicts dropped, data as base64). SEB sends SHA-256(page URL + key) with
// every request, so the server can accept the exam without staff copying the
// key from SEB's config tool. It matches apps/exam-v1/lib/seb.ts.
func ConfigKey(settings Settings) (string, error) {
	plist, err := render(settings)
	if err != nil {
		return "", err
	}
	return keyOf(plist)
}

func keyOf(plist []byte) (string, error) {
	decoder := xml.NewDecoder(bytes.NewReader(plist))
	decoder.Strict = false
	for {
		token, err := decoder.Token()
		if err != nil {
			return "", fmt.Errorf("parse SEB settings: %w", err)
		}
		if start, ok := token.(xml.StartElement); ok && start.Name.Local == "dict" {
			value, err := parseDict(decoder)
			if err != nil {
				return "", err
			}
			sum := sha256.Sum256([]byte(value))
			return hex.EncodeToString(sum[:]), nil
		}
	}
}

func parseDict(decoder *xml.Decoder) (string, error) {
	type pair struct{ key, json string }
	var pairs []pair
	var key string
	for {
		token, err := decoder.Token()
		if err != nil {
			return "", fmt.Errorf("parse SEB settings: %w", err)
		}
		switch element := token.(type) {
		case xml.EndElement:
			if element.Name.Local != "dict" {
				continue
			}
			sort.SliceStable(pairs, func(i, j int) bool {
				return strings.ToLower(pairs[i].key) < strings.ToLower(pairs[j].key)
			})
			parts := make([]string, 0, len(pairs))
			for _, p := range pairs {
				parts = append(parts, `"`+p.key+`":`+p.json)
			}
			return "{" + strings.Join(parts, ",") + "}", nil
		case xml.StartElement:
			if element.Name.Local == "key" {
				if key, err = text(decoder); err != nil {
					return "", err
				}
				continue
			}
			value, err := parseValue(decoder, element)
			if err != nil {
				return "", err
			}
			if value != "{}" {
				pairs = append(pairs, pair{key, value})
			}
		}
	}
}

func parseValue(decoder *xml.Decoder, start xml.StartElement) (string, error) {
	switch start.Name.Local {
	case "dict":
		return parseDict(decoder)
	case "array":
		var items []string
		for {
			token, err := decoder.Token()
			if err != nil {
				return "", fmt.Errorf("parse SEB settings: %w", err)
			}
			switch element := token.(type) {
			case xml.EndElement:
				if element.Name.Local == "array" {
					return "[" + strings.Join(items, ",") + "]", nil
				}
			case xml.StartElement:
				item, err := parseValue(decoder, element)
				if err != nil {
					return "", err
				}
				items = append(items, item)
			}
		}
	case "true", "false":
		return start.Name.Local, decoder.Skip()
	case "string", "data", "date":
		value, err := text(decoder)
		if start.Name.Local == "data" {
			value = strings.Join(strings.Fields(value), "")
		}
		return `"` + value + `"`, err
	case "integer", "real":
		value, err := text(decoder)
		if _, parseErr := strconv.ParseFloat(value, 64); parseErr != nil {
			return "", errors.New("parse SEB settings: bad number " + value)
		}
		return value, err
	}
	return "", fmt.Errorf("parse SEB settings: unexpected <%s>", start.Name.Local)
}

// text reads the character data of the element just opened.
func text(decoder *xml.Decoder) (string, error) {
	var value strings.Builder
	for {
		token, err := decoder.Token()
		if err != nil {
			if errors.Is(err, io.EOF) {
				err = io.ErrUnexpectedEOF
			}
			return "", fmt.Errorf("parse SEB settings: %w", err)
		}
		switch element := token.(type) {
		case xml.CharData:
			value.Write(element)
		case xml.EndElement:
			return value.String(), nil
		}
	}
}
