import axios, { AxiosError } from "axios";
import fs from "fs";
import cliProgress from "cli-progress";
import path from "path";
import Debug from "debug";
import { APIUrl, ServerType } from "./types.js";
axios.defaults.headers.common["User-Agent"] = "ezserver";
const debug = Debug("ezserver:download");

export async function downloadFile(url: string, dest: string, name?: string) {
  if (!fs.existsSync(path.dirname(dest)))
    throw new DownloadError(
      "Destination directory does not exist.",
      DownloadErrorCodes.DESTINATION_NOT_FOUND
    );
  debug("Downloading file from %s to %s", url, dest);

  return new Promise<void>(async (resolve, reject) => {
    try {
      const { data, headers } = await axios({
        url,
        method: "GET",
        responseType: "stream",
      });
      const totalLength = headers["content-length"];
      debug("Total length: %s bytes", totalLength || "unknown");
      debug(
        "Downloading file... %s",
        name || new URL(url).pathname.split("/").pop() || "unknown"
      );
      const progressBar = new cliProgress.SingleBar(
        {
          format:
            "[{bar}] {percentage}% | ETA: {eta}s | " +
            (name ||
              new URL(url).pathname.split("/").pop() ||
              "{value}/{total} bytes"),
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
    } catch (err: any) {
      if (err instanceof AxiosError) {
        if (err.status === 404 || err.response?.status === 404) {
          reject(
            new DownloadError(
              "Version not found",
              DownloadErrorCodes.VERSION_NOT_FOUND
            )
          );
        } else {
          reject(err);
        }
      } else {
        reject(err);
      }
    }
  });
}

export async function getLatestVersion(type: ServerType): Promise<string> {
  if (type == ServerType.VANILLA) {
    const { data: manifestData } = await axios.get(APIUrl.Vanilla);
    return manifestData.latest.release;
  } else if (type == ServerType.PAPER) {
    const { data: paperVersionsData } = await axios.get(APIUrl.Paper);
    return paperVersionsData.versions[paperVersionsData.versions.length - 1];
  } else {
    throw new DownloadError(
      "Unsupported server type.",
      DownloadErrorCodes.UNSUPPORTED_TYPE
    );
  }
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
      throw new DownloadError(
        "[manifest] Version not found.",
        DownloadErrorCodes.VERSION_NOT_FOUND
      );
    const { data: versionData } = await axios.get(manifestVersionData.url);
    debug("Using version data: %O", versionData.downloads.server.url);
    return versionData.downloads.server.url;
  } else if (type == ServerType.PAPER) {
    const latestVersion = await getLatestVersion(ServerType.PAPER);
    debug("Latest Paper version: %s", latestVersion);
    const selectedVersion = version === "latest" ? latestVersion : version;
    const { data: paperVersion } = await axios.get(
      APIUrl.Paper + "/versions/" + selectedVersion
    );
    const latestBuild = paperVersion.builds.pop();
    if (!latestBuild)
      throw new DownloadError(
        "No builds found for Paper.",
        DownloadErrorCodes.NO_BUILDS
      );
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
  } else if (type == ServerType.FORGE) {
    const { data: forgePromotions } = await axios.get(APIUrl.Forge);
    // last item of object
    const latestVersion = Object.keys(forgePromotions.promos).pop();
    if (!latestVersion)
      throw new DownloadError(
        "No Forge versions found.",
        DownloadErrorCodes.VERSION_NOT_FOUND
      );
    debug("Latest Forge version: %s", latestVersion);
    const selectedVersion =
      `${latestVersion.split("-")[0]}-` +
      (version === "latest"
        ? forgePromotions.promos[latestVersion]
        : forgePromotions.promos[`${version}-latest`]);
    debug("Selected Forge version: %s", selectedVersion);
    if (!selectedVersion)
      throw new DownloadError(
        "Version not found for Forge.",
        DownloadErrorCodes.VERSION_NOT_FOUND
      );
    return `https://maven.minecraftforge.net/net/minecraftforge/forge/${selectedVersion}/forge-${selectedVersion}-installer.jar`;
  } else {
    throw new DownloadError(
      "Unsupported server type.",
      DownloadErrorCodes.UNSUPPORTED_TYPE
    );
  }
}

export class DownloadError extends Error {
  constructor(message: string, public code: DownloadErrorCodes) {
    super(message);
  }
}

export enum DownloadErrorCodes {
  VERSION_NOT_FOUND,
  NO_BUILDS,
  UNSUPPORTED_TYPE,
  DESTINATION_NOT_FOUND,
}

export default {
  downloadFile,
  getDownloadURL,
  DownloadError,
  DownloadErrorCodes,
};
