// Package launchfile builds the .seb file a candidate opens to start an exam
// in Safe Exam Browser (ADR-0022). The settings and the encoding are the
// exam app's (apps/exam-v1/lib/seb.ts): a lockdown plist, gzipped,
// password-encrypted in the RNCryptor data format 2 that SEB itself writes, prefixed "pswd",
// and gzipped again.
package launchfile

import (
	"bytes"
	"compress/gzip"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"strings"
	"text/template"
)

//go:embed settings.plist.tmpl
var settingsSource string

var settingsTemplate = template.Must(template.New("settings").Funcs(template.FuncMap{
	"xml": func(value string) (string, error) {
		var escaped strings.Builder
		err := xml.EscapeText(&escaped, []byte(value))
		return escaped.String(), err
	},
}).Parse(settingsSource))

// Settings are the per-exam values of a launch file.
type Settings struct {
	// StartURL is the page SEB opens once the file is loaded.
	StartURL string
	// QuitURL is the page that makes SEB quit when the candidate reaches it.
	QuitURL string
	// Password encrypts the file and is SEB's quit password.
	Password string
}

// Build returns the .seb file for settings.
func Build(settings Settings) ([]byte, error) {
	if settings.StartURL == "" || settings.QuitURL == "" || settings.Password == "" {
		return nil, errors.New("launch file needs a start URL, a quit URL and a password")
	}
	quitPassword := sha256.Sum256([]byte(settings.Password))
	var plist bytes.Buffer
	if err := settingsTemplate.Execute(&plist, struct {
		StartURL, QuitURL, HashedQuitPassword string
	}{settings.StartURL, settings.QuitURL, hex.EncodeToString(quitPassword[:])}); err != nil {
		return nil, fmt.Errorf("render SEB settings: %w", err)
	}
	inner, err := gzipBytes(plist.Bytes())
	if err != nil {
		return nil, err
	}
	encrypted, err := encrypt(inner, settings.Password)
	if err != nil {
		return nil, err
	}
	return gzipBytes(append([]byte("pswd"), encrypted...))
}

// Filename is the download name for an exam title, as the exam app names it.
func Filename(title string) string {
	var slug strings.Builder
	dash := false
	for _, character := range strings.ToLower(title) {
		if (character >= 'a' && character <= 'z') || (character >= '0' && character <= '9') {
			slug.WriteRune(character)
			dash = false
		} else if !dash && slug.Len() > 0 {
			slug.WriteByte('-')
			dash = true
		}
	}
	name := strings.TrimSuffix(slug.String(), "-")
	if len(name) > 40 {
		name = strings.TrimSuffix(name[:40], "-")
	}
	if name == "" {
		name = "exam"
	}
	return name + ".seb"
}

const (
	formatVersion = 0x02 // SEB rejects other versions as a wrong password (exam app, 08d7c0a)
	formatOptions = 0x01 // password-based keys
	saltBytes     = 8
	pbkdf2Rounds  = 10_000
	keyBytes      = 32
	headerBytes   = 2 + 2*saltBytes + aes.BlockSize
	hmacBytes     = sha256.Size
)

// encrypt writes plaintext in RNCryptor data format 2 with a password:
// version | options | encryption salt | HMAC salt | IV | AES-256-CBC ciphertext | HMAC-SHA256.
func encrypt(plaintext []byte, password string) ([]byte, error) {
	header := make([]byte, headerBytes)
	header[0], header[1] = formatVersion, formatOptions
	if _, err := rand.Read(header[2:]); err != nil {
		return nil, fmt.Errorf("generate SEB file salts: %w", err)
	}
	encryptionSalt, hmacSalt, iv := header[2:2+saltBytes], header[2+saltBytes:2+2*saltBytes], header[2+2*saltBytes:]
	encryptionKey, hmacKey, err := keys(password, encryptionSalt, hmacSalt)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(encryptionKey)
	if err != nil {
		return nil, fmt.Errorf("create SEB file cipher: %w", err)
	}
	padding := aes.BlockSize - len(plaintext)%aes.BlockSize
	padded := append(bytes.Clone(plaintext), bytes.Repeat([]byte{byte(padding)}, padding)...)
	message := append(header, make([]byte, len(padded))...)
	cipher.NewCBCEncrypter(block, iv).CryptBlocks(message[headerBytes:], padded)
	mac := hmac.New(sha256.New, hmacKey)
	mac.Write(message)
	return mac.Sum(message), nil
}

func keys(password string, encryptionSalt, hmacSalt []byte) ([]byte, []byte, error) {
	encryptionKey, err := pbkdf2.Key(sha1.New, password, encryptionSalt, pbkdf2Rounds, keyBytes)
	if err != nil {
		return nil, nil, fmt.Errorf("derive SEB file key: %w", err)
	}
	hmacKey, err := pbkdf2.Key(sha1.New, password, hmacSalt, pbkdf2Rounds, keyBytes)
	if err != nil {
		return nil, nil, fmt.Errorf("derive SEB file key: %w", err)
	}
	return encryptionKey, hmacKey, nil
}

func gzipBytes(data []byte) ([]byte, error) {
	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	if _, err := writer.Write(data); err != nil {
		return nil, fmt.Errorf("compress SEB file: %w", err)
	}
	if err := writer.Close(); err != nil {
		return nil, fmt.Errorf("compress SEB file: %w", err)
	}
	return compressed.Bytes(), nil
}
