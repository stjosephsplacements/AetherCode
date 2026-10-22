package similarity

import (
	"fmt"
	"strings"
	"testing"
)

const original = `#include <stdio.h>
// read numbers and print the longest increasing run
int main() {
    int n, best = 0, run = 0, previous = -1;
    scanf("%d", &n);
    for (int i = 0; i < n; i++) {
        int value;
        scanf("%d", &value);
        if (value > previous) { run++; } else { run = 1; }
        if (run > best) best = run;
        previous = value;
    }
    while (best > 100) { best -= 7; best *= 2; }
    printf("%d\n", best);
    return 0;
}`

// renamed is original with every name changed, comments and layout altered.
const renamed = `#include <stdio.h>
int main() { int count, top = 0, streak = 0, last = -1;
  scanf("%d", &count);
  for (int k = 0; k < count; k++) { int x; scanf("%d", &x);
    if (x > last) { streak++; } else { streak = 1; }
    if (streak > top) top = streak; last = x; }
  /* cap it */ while (top > 100) { top -= 7; top *= 2; }
  printf("%d\n", top); return 0; }`

const different = `#include <stdio.h>
int main() {
    long total = 0; int a;
    while (scanf("%d", &a) == 1) {
        switch (a % 3) { case 0: total += a; break; case 1: total -= a; break; default: total ^= a; }
    }
    do { total /= 2; } while (total > 1000);
    printf("%ld\n", total);
    return 0;
}`

func TestTokenizeIgnoresNamesLiteralsAndComments(t *testing.T) {
	got := strings.Join(Tokenize(`int total = 42; // note
	printf("x");`), " ")
	if got != `int V = N ; V ( S ) ;` {
		t.Fatalf("tokens = %q", got)
	}
}

func TestPairsFindsRenamedCopiesOnly(t *testing.T) {
	programs := []Program{{ID: "a", Source: original}, {ID: "b", Source: renamed}, {ID: "c", Source: different}}
	for index := range 6 {
		// Distinct filler students so that a and b's code is not "common".
		programs = append(programs, Program{ID: fmt.Sprintf("z%d", index), Source: strings.Repeat(fmt.Sprintf("x%d = y%d + %d;\n", index, index, index), 1) + different[:40]})
	}
	pairs := Pairs(programs, 0.6, 0.5)
	if len(pairs) == 0 || pairs[0].A != "a" || pairs[0].B != "b" || pairs[0].Score < 0.9 {
		t.Fatalf("pairs = %+v, want a renamed copy at the top", pairs)
	}
	for _, pair := range pairs {
		if (pair.A == "a" || pair.B == "a") && (pair.A == "c" || pair.B == "c") {
			t.Fatalf("different code paired: %+v", pair)
		}
	}
}

func TestPairsIgnoresCodeEveryoneWrote(t *testing.T) {
	var programs []Program
	for index := range 10 {
		programs = append(programs, Program{ID: fmt.Sprintf("s%d", index), Source: original})
	}
	if pairs := Pairs(programs, 0.6, 0.5); len(pairs) != 0 {
		t.Fatalf("pairs = %d, want none: the whole class wrote this", len(pairs))
	}
}
