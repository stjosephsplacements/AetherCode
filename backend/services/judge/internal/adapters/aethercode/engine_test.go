package aethercode

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/aethercode/aethercode/services/judge/internal/dispatcher"
)

// TestAgainstRealEngine runs every platform language on a live engine. It
// runs only when AETHERCODE_ENGINE_URL is set, for example through an SSH
// tunnel to the campus server:
//
//	ssh -L 15100:172.17.0.1:5100 <host>
//	AETHERCODE_ENGINE_URL=http://127.0.0.1:15100 go test ./internal/adapters/aethercode/
func TestAgainstRealEngine(t *testing.T) {
	baseURL := os.Getenv("AETHERCODE_ENGINE_URL")
	if baseURL == "" {
		t.Skip("AETHERCODE_ENGINE_URL is not set")
	}
	client, err := NewClient(baseURL, 2*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	sum := map[string]string{
		"c":          "#include <stdio.h>\nint main(){int a,b;scanf(\"%d %d\",&a,&b);printf(\"%d\\n\",a+b);}",
		"cpp17":      "#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b<<\"\\n\";}",
		"java":       "import java.util.*;\npublic class Main{public static void main(String[] x){Scanner s=new Scanner(System.in);System.out.println(s.nextInt()+s.nextInt());}}",
		"python3":    "a, b = map(int, input().split())\nprint(a + b)",
		"javascript": "const [a, b] = require('fs').readFileSync(0, 'utf8').trim().split(' ').map(Number);\nconsole.log(a + b);",
		"go":         "package main\nimport \"fmt\"\nfunc main(){var a,b int;fmt.Scan(&a,&b);fmt.Println(a+b)}",
	}
	for language, source := range sum {
		t.Run(language, func(t *testing.T) {
			t.Parallel()
			for _, check := range []struct{ expected, want string }{{"42\n", "accepted"}, {"41\n", "wrong_answer"}} {
				token, err := client.Submit(context.Background(), dispatcher.UnitRequest{
					Language: language, SourceCode: source, Stdin: "20 22\n", ExpectedOutput: check.expected,
					TimeLimitMS: 2000, MemLimitKB: 262144,
				})
				if err != nil {
					t.Fatalf("Submit: %v", err)
				}
				verdict, _ := client.Poll(context.Background(), token)
				if verdict.Status != check.want {
					t.Fatalf("expected %q: verdict %+v, want %s", check.expected, verdict, check.want)
				}
			}
		})
	}
	t.Run("compile error and time limit", func(t *testing.T) {
		token, err := client.Submit(context.Background(), dispatcher.UnitRequest{Language: "c", SourceCode: "int main( {", TimeLimitMS: 1000, MemLimitKB: 65536})
		if err != nil {
			t.Fatal(err)
		}
		if verdict, _ := client.Poll(context.Background(), token); verdict.Status != "compile_error" || verdict.CompileOutput == "" {
			t.Fatalf("verdict %+v, want compile_error with output", verdict)
		}
		token, err = client.Submit(context.Background(), dispatcher.UnitRequest{Language: "python3", SourceCode: "while True: pass", TimeLimitMS: 500, MemLimitKB: 65536})
		if err != nil {
			t.Fatal(err)
		}
		if verdict, _ := client.Poll(context.Background(), token); verdict.Status != "time_limit_exceeded" {
			t.Fatalf("verdict %+v, want time_limit_exceeded", verdict)
		}
	})
}
