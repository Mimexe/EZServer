/* Copyright 2013 Joseph Spencer.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * Code modified by the author of this project.
 */

import * as fs from "fs";
import * as path from "path";
import * as cp from "child_process";
import { execSync } from "child_process";
import which from "which";
import WinReg, { Registry } from "winreg";
import axios from "axios";
import { APIUrl } from "./types.js";

const isWindows: boolean = process.platform.indexOf("win") === 0;
const jdkRegistryKeyPaths: string[] = [
  "\\SOFTWARE\\JavaSoft\\JDK",
  "\\SOFTWARE\\JavaSoft\\Java Development Kit",
];
const jreRegistryKeyPaths: string[] = [
  "\\SOFTWARE\\JavaSoft\\Java Runtime Environment",
];

declare namespace findJavaHome {
  interface IOptions {
    allowJre: boolean;
    registry?: RegArch;
  }
}
type RegArch = "x86" | "x64";
type Callback = (err: Error, res: any) => void;

async function findJavaHome(
  optionsOrCb: findJavaHome.IOptions | Callback,
  optional?: Callback
) {
  let cb: Callback;
  let options: findJavaHome.IOptions | undefined;
  if (!optional) {
    cb = <Callback>optionsOrCb;
    options = undefined;
  } else {
    options = <findJavaHome.IOptions>optionsOrCb;
    cb = optional;
  }

  let res = undefined;
  let err = null;
  try {
    res = await findJavaHomePromise(options);
  } catch (error: any) {
    err = error;
  }
  cb(err, res);
}

findJavaHome.promise = findJavaHomePromise();

async function findJavaHomePromise(
  options?: findJavaHome.IOptions
): Promise<string[] | null> {
  const allowJre: boolean = !!(options && options.allowJre);
  const JAVA_FILENAME =
    (allowJre ? "java" : "javac") + (isWindows ? ".exe" : "");
  // Search both "x64" and "x86" registries for Java runtimes if not specified
  const regs: RegArch[] =
    options && options.registry ? [options.registry] : ["x64", "x86"];

  const javaHomes = [];
  // From env
  if (
    process.env.JAVA_HOME &&
    dirIsJavaHome(process.env.JAVA_HOME, JAVA_FILENAME)
  ) {
    javaHomes.push(process.env.JAVA_HOME);
  }

  // From registry (windows only)
  if (isWindows) {
    const possibleKeyPaths: string[] = allowJre
      ? jdkRegistryKeyPaths.concat(jreRegistryKeyPaths)
      : jdkRegistryKeyPaths;
    const javaHome = await findInRegistry(possibleKeyPaths, regs);
    if (javaHome) {
      javaHomes.push(...javaHome);
    }
  }

  // From PATH
  javaHomes.push(...((await findInPath(JAVA_FILENAME)) || []));
  // Dedupe
  return Array.from(new Set(javaHomes));
}

function findInPath(JAVA_FILENAME: string) {
  return new Promise<string[] | null>(async (resolve) => {
    let proposed = await which(JAVA_FILENAME).catch(() => {
      resolve(null);
      return null;
    });
    if (!proposed) {
      return resolve(null);
    }

    if (/\.jenv\/shims/.test(proposed)) {
      try {
        proposed = execSync(`jenv which ${JAVA_FILENAME}`).toString().trim();
      } catch (ex) {
        console.error(ex);
      }
    }

    //resolve symlinks
    proposed = fs.realpathSync(proposed);

    //get the /bin directory
    proposed = path.dirname(proposed);

    //on mac, java install has a utility script called java_home that does the
    //dirty work for us
    const macUtility = path.resolve(proposed, "java_home");
    if (fs.existsSync(macUtility)) {
      let buffer;
      try {
        buffer = cp.execSync(macUtility, { cwd: proposed });
        const javaHome = "" + buffer.toString().replace(/\n$/, "");
        return resolve([javaHome]);
      } catch (error) {
        return resolve(null);
      }
    }

    //up one from /bin
    resolve([path.dirname(proposed)]);
  });
}

async function findInRegistry(
  keyPaths: string[],
  regArchs: RegArch[]
): Promise<string[] | null> {
  if (!keyPaths.length) return null;

  const promises = [];
  for (const arch of regArchs) {
    for (const keyPath of keyPaths) {
      promises.push(promisifyFindPossibleRegKey(keyPath, arch));
    }
  }

  const keysFoundSegments: Registry[][] = await Promise.all(promises);
  const keysFound: Registry[] = Array.prototype.concat.apply(
    [],
    keysFoundSegments
  );
  if (!keysFound.length) return null;

  const sortedKeysFound = keysFound.sort(function (a, b) {
    const aVer = parseFloat(a.key);
    const bVer = parseFloat(b.key);
    return bVer - aVer;
  });
  const javaHomes: string[] = [];
  for (const key of sortedKeysFound) {
    const res = await promisifyFindJavaHomeInRegKey(key);
    if (res) {
      javaHomes.push(res);
    }
  }
  return javaHomes || null;
}

function promisifyFindPossibleRegKey(
  keyPath: string,
  regArch: RegArch
): Promise<Registry[]> {
  return new Promise<Registry[]>((resolve) => {
    const winreg: Registry = new WinReg({
      hive: WinReg.HKLM,
      key: keyPath,
      arch: regArch,
    });
    winreg.keys((err: any, result: any) => {
      if (err) {
        return resolve([]);
      }
      resolve(result);
    });
  });
}

function promisifyFindJavaHomeInRegKey(reg: Registry): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    reg.get("JavaHome", function (err: any, home: any) {
      if (err || !home) {
        return resolve(null);
      }
      resolve(home.value);
    });
  });
}

function dirIsJavaHome(dir: string, javaFilename: string): boolean {
  return (
    fs.existsSync("" + dir) &&
    fs.statSync(dir).isDirectory() &&
    fs.existsSync(path.resolve(dir, "bin", javaFilename))
  );
}

export default async function getJavaPaths(): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    findJavaHome({ allowJre: true }, (err, res) => {
      if (err) {
        reject(err);
      }
      resolve(res || []);
    });
  });
}

export async function getJavaForMCVersion(
  version: string,
  javaVersions: {
    version: string;
    path: string;
    detectedVersion: number | string;
  }[]
): Promise<string | null> {
  // Get the versions from mojang
  const { data: manifestData } = await axios.get(APIUrl.Vanilla);
  const versions = manifestData.versions;
  let manifestVersionData = versions.find((v: any) => {
    if (version === "latest") {
      return v.id == manifestData.latest.release;
    }
    return v.id === version;
  });
  if (!manifestVersionData || !manifestVersionData.url) return null;
  const { data: versionData } = await axios.get(manifestVersionData.url);
  const requiredJavaVersion = versionData.javaVersion?.majorVersion;
  if (!requiredJavaVersion) return null;
  const javaVersion = javaVersions.find(
    (v) => v.detectedVersion === requiredJavaVersion
  );
  if (!javaVersion) {
    // Must be a higher version or equal
    const higherVersions = javaVersions.filter(
      (v) => v.detectedVersion >= requiredJavaVersion
    );
    if (!higherVersions.length) return null;
    higherVersions.sort((a, b) => {
      if (
        typeof a.detectedVersion === "string" ||
        typeof b.detectedVersion === "string"
      ) {
        return 0;
      }
      return a.detectedVersion - b.detectedVersion;
    });
    return higherVersions[0].path;
  }
  return javaVersion.path;
}
