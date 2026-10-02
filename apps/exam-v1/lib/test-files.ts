// Pairs uploaded test files into (input, expected output) cases. Accepts the
// HackerRank export layout (input/input00.txt + output/output00.txt) and the
// common `1.in`/`1.out`, `input1.txt`/`output1.txt` conventions.

export interface PairedTest {
  name: string;
  input: string;
  expectedOutput: string;
}

const INPUT = /^(?:input|in)[_-]?(\d+)\.(?:txt|in)$|^(\d+)\.in$/i;
const OUTPUT = /^(?:output|out|expected|ans)[_-]?(\d+)\.(?:txt|out|ans)$|^(\d+)\.(?:out|ans)$/i;

export function pairTestFiles(files: Array<{ path: string; content: string }>): { tests: PairedTest[]; unmatched: string[] } {
  const inputs = new Map<number, string>();
  const outputs = new Map<number, string>();
  const unmatched: string[] = [];
  for (const file of files) {
    const base = file.path.split("/").pop() ?? file.path;
    const input = INPUT.exec(base);
    const output = OUTPUT.exec(base);
    if (input) inputs.set(Number(input[1] ?? input[2]), file.content);
    else if (output) outputs.set(Number(output[1] ?? output[2]), file.content);
    else unmatched.push(file.path);
  }
  const numbers = [...new Set([...inputs.keys(), ...outputs.keys()])].sort((a, b) => a - b);
  const tests: PairedTest[] = [];
  for (const number of numbers) {
    const input = inputs.get(number);
    const expectedOutput = outputs.get(number);
    if (input === undefined || expectedOutput === undefined) {
      unmatched.push(`test ${number} (missing ${input === undefined ? "input" : "output"})`);
      continue;
    }
    tests.push({ name: String(number), input, expectedOutput });
  }
  return { tests, unmatched };
}

// Reads a ZIP archive in the browser (stored and deflate entries) using the
// platform's DecompressionStream.
export async function readZip(buffer: ArrayBuffer): Promise<Array<{ path: string; content: string }>> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new Error("Not a ZIP file");
  const count = view.getUint16(end + 10, true);
  let pointer = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const files: Array<{ path: string; content: string }> = [];
  for (let entry = 0; entry < count; entry++) {
    if (view.getUint32(pointer, true) !== 0x02014b50) throw new Error("Corrupt ZIP directory");
    const method = view.getUint16(pointer + 10, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const path = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));
    pointer += 46 + nameLength + extraLength + commentLength;
    if (path.endsWith("/") || path.startsWith("__MACOSX/")) continue;
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.slice(start, start + compressedSize);
    let content: Uint8Array;
    if (method === 0) content = data;
    else if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      content = new Uint8Array(await new Response(stream).arrayBuffer());
    } else throw new Error(`Unsupported compression in ${path}`);
    files.push({ path, content: decoder.decode(content) });
  }
  return files;
}
