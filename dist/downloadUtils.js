import axios from "axios";
import fs from "fs";
import cliProgress from "cli-progress";
import path from "path";
import Debug from "debug";
import { ServerType } from "../index.js";
const debug = Debug("ezserver:download");
export async function downloadFile(url, dest) {
    //   with cli-progress and axios
    if (!fs.existsSync(path.dirname(dest)))
        throw new Error("Destination directory does not exist.");
    debug("Downloading file from %s to %s", url, dest);
    return new Promise(async (resolve, reject) => {
        const { data, headers } = await axios({
            url,
            method: "GET",
            responseType: "stream",
        });
        const totalLength = headers["content-length"];
        debug("Total length: %s bytes", totalLength || "unknown");
        const progressBar = new cliProgress.SingleBar({
            format: "[{bar}] {percentage}% | ETA: {eta}s | {value}/{total} bytes",
        }, cliProgress.Presets.shades_classic);
        progressBar.start(totalLength || 0, 0);
        const writer = fs.createWriteStream(path.resolve(dest));
        data.on("data", (chunk) => {
            progressBar.increment(chunk.length);
            if (!totalLength) {
                progressBar.setTotal(progressBar.getTotal() + chunk.length);
            }
        });
        data.on("end", () => {
            progressBar.stop();
            resolve();
        });
        writer.on("error", (err) => {
            progressBar.stop();
            reject(err);
        });
        data.pipe(writer);
    });
}
export async function getVersionForType(version, type) {
    debug("Getting version for type %s and version %s", type, version);
    if (type == ServerType.VANILLA) {
        const { data } = await axios.get("https://launchermeta.mojang.com/mc/game/version_manifest.json");
        const versions = data.versions;
        const versionData = versions.find((v) => v.id === version);
        if (!versionData)
            throw new Error("Version not found.");
        return versionData.url;
    }
}
export default {
    downloadFile,
    getVersionForType,
};
