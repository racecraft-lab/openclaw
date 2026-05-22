import "./fs-safe-defaults.js";
import { writeJson as writeJsonBase } from "@openclaw/fs-safe/json";
import { replaceFileAtomic } from "./replace-file.js";

export {
  JsonFileReadError,
  readJson,
  readJson as readJsonFileStrict,
  readJsonIfExists,
  readJsonIfExists as readDurableJsonFile,
  readJsonSync,
  readRootJsonObjectSync,
  readRootJsonSync,
  readRootStructuredFileSync,
  tryReadJson,
  tryReadJson as readJsonFile,
  tryReadJsonSync,
  tryReadJsonSync as readJsonFileSync,
  writeJsonSync,
} from "@openclaw/fs-safe/json";
export { createAsyncLock } from "@openclaw/fs-safe/advanced";

export type WriteTextAtomicOptions = {
  mode?: number;
  dirMode?: number;
  trailingNewline?: boolean;
  durable?: boolean;
};

export type WriteJsonAtomicOptions = WriteTextAtomicOptions;

export async function writeJson(
  filePath: string,
  value: unknown,
  options?: WriteJsonAtomicOptions,
): Promise<void> {
  await writeJsonBase(filePath, value, {
    ...options,
    dirMode: options?.dirMode ?? 0o700,
  });
}

export const writeJsonAtomic = writeJson;

export async function writeTextAtomic(
  filePath: string,
  content: string,
  options?: WriteTextAtomicOptions,
): Promise<void> {
  const payload = options?.trailingNewline && !content.endsWith("\n") ? `${content}\n` : content;
  await replaceFileAtomic({
    filePath,
    content: payload,
    mode: options?.mode ?? 0o600,
    dirMode: options?.dirMode ?? 0o700,
    copyFallbackOnPermissionError: true,
    syncTempFile: options?.durable !== false,
    syncParentDir: options?.durable !== false,
  });
}
