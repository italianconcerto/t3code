import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DESKTOP_APP_ID = "com.t3tools.t3code";

interface AfterPackContext {
  readonly appOutDir: string;
  readonly packager: {
    readonly appInfo: {
      readonly productFilename: string;
    };
  };
}

export default async function signMacosAdhoc(context: AfterPackContext): Promise<void> {
  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`;

  // First seal every nested executable, then replace only the outer app's
  // designated requirement. The stable requirement lets Squirrel validate a
  // later build even though ad-hoc cdhash values change on every release.
  await execFileAsync("codesign", ["--force", "--deep", "--sign", "-", appPath]);
  await execFileAsync("codesign", [
    "--force",
    "--sign",
    "-",
    "--requirements",
    `=designated => identifier "${DESKTOP_APP_ID}"`,
    appPath,
  ]);
  await execFileAsync("codesign", ["--verify", "--deep", "--strict", appPath]);
}
