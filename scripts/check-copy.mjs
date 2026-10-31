// 配布ファイルだけを別ディレクトリにコピーして型チェックします。
// node_modulesは親ディレクトリから解決します。srcの他ファイルはコピーしません。
import { mkdtempSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
const root = process.cwd();
const temporary = mkdtempSync(join(root, ".copy-check-"));
try {
  copyFileSync(
    resolve("src/AsyncTasks.tsx"),
    join(temporary, "AsyncTasks.tsx"),
  );
  writeFileSync(
    join(temporary, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        lib: ["ES2022", "DOM"],
        module: "ESNext",
        moduleResolution: "Bundler",
        jsx: "react-jsx",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ["AsyncTasks.tsx"],
    }),
  );
  const check = spawnSync(
    process.execPath,
    [resolve("node_modules/typescript/bin/tsc"), "-p", temporary],
    { stdio: "inherit" },
  );
  process.exitCode = check.status ?? 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
