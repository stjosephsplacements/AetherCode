package launchfile

import (
	"bytes"
	"compress/gzip"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"
)

func TestBuildDecodesToTheExamSettings(t *testing.T) {
	t.Parallel()
	file, err := Build(Settings{
		StartURL: "https://exam.example/exam/42?a=1&b=2",
		QuitURL:  "https://exam.example/student",
		Password: "launch-secret",
	})
	if err != nil {
		t.Fatalf("Build() error = %v", err)
	}
	outer := gunzip(t, file)
	if !bytes.HasPrefix(outer, []byte("pswd")) {
		t.Fatalf("launch file is not password protected: %q", outer[:8])
	}
	if outer[4] != 0x02 || outer[5] != 0x01 {
		t.Fatalf("RNCryptor header = %#x %#x, want 0x02 0x01", outer[4], outer[5])
	}
	if _, err := decrypt(outer[4:], "wrong"); err == nil {
		t.Fatal("decrypt() with the wrong password succeeded")
	}
	inner, err := decrypt(outer[4:], "launch-secret")
	if err != nil {
		t.Fatalf("decrypt() error = %v", err)
	}
	plist := string(gunzip(t, inner))
	quit := sha256.Sum256([]byte("launch-secret"))
	for _, want := range []string{
		"<string>https://exam.example/exam/42?a=1&amp;b=2</string>",
		"<string>https://exam.example/student</string>",
		"<string>" + hex.EncodeToString(quit[:]) + "</string>",
		"<key>sendBrowserExamKey</key>\n\t<true/>",
	} {
		if !strings.Contains(plist, want) {
			t.Errorf("settings lack %q", want)
		}
	}
}

func TestBuildRequiresEverySetting(t *testing.T) {
	t.Parallel()
	if _, err := Build(Settings{StartURL: "https://exam.example/exam/1", QuitURL: "https://exam.example/student"}); err == nil {
		t.Fatal("Build() without a password succeeded")
	}
}

func TestFilename(t *testing.T) {
	t.Parallel()
	for title, want := range map[string]string{
		"Data Structures — Mid Term!": "data-structures-mid-term.seb",
		"   ":                         "exam.seb",
		strings.Repeat("ab ", 30):     "ab-ab-ab-ab-ab-ab-ab-ab-ab-ab-ab-ab-ab-a.seb",
	} {
		if got := Filename(title); got != want {
			t.Errorf("Filename(%q) = %q, want %q", title, got, want)
		}
	}
}

func gunzip(t *testing.T, data []byte) []byte {
	t.Helper()
	reader, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("gzip.NewReader() error = %v", err)
	}
	plain, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("read gzip: %v", err)
	}
	return plain
}

// decrypt reverses encrypt after checking the HMAC.
func decrypt(message []byte, password string) ([]byte, error) {
	if len(message) < headerBytes+aes.BlockSize+hmacBytes || message[0] != formatVersion || message[1] != formatOptions ||
		(len(message)-headerBytes-hmacBytes)%aes.BlockSize != 0 {
		return nil, errors.New("not an RNCryptor format 2 password message")
	}
	encryptionKey, hmacKey, err := keys(password, message[2:2+saltBytes], message[2+saltBytes:2+2*saltBytes])
	if err != nil {
		return nil, err
	}
	body, tag := message[:len(message)-hmacBytes], message[len(message)-hmacBytes:]
	mac := hmac.New(sha256.New, hmacKey)
	mac.Write(body)
	if !hmac.Equal(mac.Sum(nil), tag) {
		return nil, errors.New("SEB file HMAC does not match")
	}
	block, err := aes.NewCipher(encryptionKey)
	if err != nil {
		return nil, fmt.Errorf("create SEB file cipher: %w", err)
	}
	plaintext := make([]byte, len(body)-headerBytes)
	cipher.NewCBCDecrypter(block, body[2+2*saltBytes:headerBytes]).CryptBlocks(plaintext, body[headerBytes:])
	padding := int(plaintext[len(plaintext)-1])
	if padding < 1 || padding > aes.BlockSize {
		return nil, errors.New("SEB file padding is invalid")
	}
	return plaintext[:len(plaintext)-padding], nil
}
