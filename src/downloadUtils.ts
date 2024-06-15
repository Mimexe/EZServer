import axios from "axios";
import fs from "fs";
import cliProgress from "cli-progress";
import path from "path";
import Debug from "debug";
import { APIUrl, ServerType } from "./types.js";
const debug = Debug("ezserver:download");
axios.prototype.get = async function (...args: any[]) {
  debug("GET %O", args);
  return this.get(...args);
};

export async function downloadFile(url: string, dest: string) {
  if (!fs.existsSync(path.dirname(dest)))
    throw new Error("Destination directory does not exist.");
  debug("Downloading file from %s to %s", url, dest);

  return new Promise<void>(async (resolve, reject) => {
    const { data, headers } = await axios({
      url,
      method: "GET",
      responseType: "stream",
    });
    const totalLength = headers["content-length"];
    debug("Total length: %s bytes", totalLength || "unknown");
    debug(
      "Downloading file... %s",
      new URL(url).pathname.split("/").pop() || "unknown"
    );
    const progressBar = new cliProgress.SingleBar(
      {
        format:
          "[{bar}] {percentage}% | ETA: {eta}s | " +
            new URL(url).pathname.split("/").pop() || "{value}/{total} bytes",
      },
      cliProgress.Presets.shades_classic
    );
    progressBar.start(totalLength || 0, 0);

    const writer = fs.createWriteStream(path.resolve(dest));

    data.on("data", (chunk: any) => {
      progressBar.increment(chunk.length);
      if (!totalLength) {
        progressBar.setTotal(progressBar.getTotal() + chunk.length);
      }
    });
    data.on("end", () => {
      progressBar.stop();
      resolve();
    });
    writer.on("error", (err: Error) => {
      progressBar.stop();
      reject(err);
    });

    data.pipe(writer);
  });
}

export async function getDownloadURL(
  version: string,
  type: ServerType
): Promise<string> {
  debug("Getting version for type %s and version %s", type, version);
  if (type == ServerType.VANILLA) {
    const { data: manifestData } = await axios.get(APIUrl.Vanilla);
    const versions = manifestData.versions;
    let manifestVersionData = versions.find((v: any) => {
      if (version === "latest") {
        return v.id == manifestData.latest.release;
      }
      return v.id === version;
    });
    debug("Using manifest version data: %O", manifestVersionData);
    if (!manifestVersionData || !manifestVersionData.url)
      throw new Error("[manifest] Version not found.");
    const { data: versionData } = await axios.get(manifestVersionData.url);
    debug("Using version data: %O", versionData.downloads.server.url);
    return versionData.downloads.server.url;
  } else if (type == ServerType.PAPER) {
    const { data: paperVersionsData } = await axios.get(APIUrl.Paper);
    const latestVersion =
      paperVersionsData.versions[paperVersionsData.versions.length - 1];
    debug("Latest Paper version: %s", latestVersion);
    const selectedVersion = paperVersionsData.versions.find((v: any) => {
      if (version === "latest") {
        return v == latestVersion;
      }
      return v == version;
    });
    debug("Using version: %s", selectedVersion);
    if (!selectedVersion) throw new Error("No versions found for Paper.");
    const { data: paperVersion } = await axios.get(
      APIUrl.Paper + "/versions/" + selectedVersion
    );
    const latestBuild = paperVersion.builds.pop();
    if (!latestBuild) throw new Error("No builds found for Paper.");
    debug("Using Paper build: %s", latestBuild);
    return (
      APIUrl.Paper +
      "/versions/" +
      selectedVersion +
      "/builds/" +
      latestBuild +
      "/downloads/paper-" +
      selectedVersion +
      "-" +
      latestBuild +
      ".jar"
    );
  } else {
    throw new Error("Unsupported server type.");
  }
}

export default {
  downloadFile,
  getDownloadURL,
};
