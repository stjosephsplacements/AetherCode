import { test } from "node:test";
import assert from "node:assert/strict";
import { similarPairs, tokenize } from "./similarity.ts";

const original = `#include <stdio.h>
int main(void) {
    int n, a[1000];
    scanf("%d", &n);
    for (int i = 0; i < n; i++) scanf("%d", &a[i]);
    // bubble sort
    for (int i = 0; i < n - 1; i++)
        for (int j = 0; j < n - i - 1; j++)
            if (a[j] > a[j + 1]) { int t = a[j]; a[j] = a[j + 1]; a[j + 1] = t; }
    for (int i = 0; i < n; i++) printf("%d ", a[i]);
    return 0;
}`;

// Same program with renamed variables, new comments and different layout.
const disguised = `#include <stdio.h>
/* my own work */
int main(void){int count,arr[1000];scanf("%d",&count);
for(int k=0;k<count;k++)scanf("%d",&arr[k]);
for(int k=0;k<count-1;k++) for(int m=0;m<count-k-1;m++)
 if(arr[m]>arr[m+1]){int tmp=arr[m];arr[m]=arr[m+1];arr[m+1]=tmp;}
for(int k=0;k<count;k++)printf("%d ",arr[k]); return 0;}`;

const different = `#include <stdio.h>
#include <stdlib.h>
int cmp(const void *x, const void *y) { return *(const int *)x - *(const int *)y; }
int main(void) {
    int n; scanf("%d", &n);
    int *v = malloc(sizeof(int) * n);
    for (int i = 0; i < n; i++) scanf("%d", v + i);
    qsort(v, n, sizeof(int), cmp);
    for (int i = 0; i < n; i++) printf("%d%c", v[i], i + 1 == n ? '\\n' : ' ');
    free(v);
    return 0;
}`;

const python = `n = int(input())
values = sorted(map(int, input().split()))
print(" ".join(str(x) for x in values))`;

test("tokenize ignores names, literals and comments", () => {
  assert.deepEqual(tokenize("int total = 42; // note"), tokenize("int x = 7; /* other */"));
  assert.deepEqual(tokenize('print("hi")  # comment'), ["print", "(", "S", ")"]);
});

test("a disguised copy is flagged; independent solutions are not", () => {
  const pairs = similarPairs([
    { id: "orig", source: original },
    { id: "copy", source: disguised },
    { id: "qsort", source: different },
    { id: "py", source: python },
  ]);
  assert.equal(pairs.length, 1);
  assert.deepEqual([pairs[0].a, pairs[0].b].sort(), ["copy", "orig"]);
  assert.ok(pairs[0].score >= 0.8, `score ${pairs[0].score}`);
});

test("code most of the class shares is not evidence", () => {
  // Everyone wrote the same bubble sort (e.g. from the lecture notes).
  const documents = Array.from({ length: 6 }, (_, index) => ({ id: `s${index}`, source: original }));
  assert.deepEqual(similarPairs(documents), []);
});
