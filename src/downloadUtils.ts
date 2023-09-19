import Logger from "mime-logger";
import fs from "fs";
import axios from "axios";
import cliProgress from "cli-progress";
export default class DownloadUtils {
  private logger: Logger;
  constructor() {
    this.logger = new Logger("DownloadUtils");
    axios.defaults.headers.common["User-Agent"] = "EZServer";
    axios.defaults.headers.common["Accept"] = "application/json";
  }

  public async getVanillaUrl(version: string): Promise<string> {
    const manifest = await axios.get(
      "https://launchermeta.mojang.com/mc/game/version_manifest.json"
    );
    const versionManifest = manifest.data.versions.find(
      (v: any) => v.id === version
    );
    if (!versionManifest) {
      this.logger.error("Invalid version: " + version);
      process.exit(1);
    }
    if (versionManifest.type !== "release") {
      this.logger.error("Invalid version type: " + versionManifest.type);
      process.exit(1);
    }
    const versionJson = await axios.get(versionManifest.url);
    const serverUrl = versionJson.data.downloads.server.url;
    return serverUrl;
  }

  public async getPaperUrl(version: string): Promise<string> {
    const versionBuilds = await axios
      .get("https://api.papermc.io/v2/projects/paper/versions/" + version)
      .then((res) => res.data.builds);
    const latestBuild = versionBuilds[versionBuilds.length - 1];
    const serverUrl = `https://papermc.io/api/v2/projects/paper/versions/${version}/builds/${latestBuild}/downloads/paper-${version}-${latestBuild}.jar`;
    return serverUrl;
  }

  public async getDownloadUrl(server: Server): Promise<string> {
    if (process.argv.includes("--url")) {
      const url = process.argv[process.argv.indexOf("--url") + 1];
      const urlCondition =
        url.startsWith("https://download.getbukkit.org/") ||
        url.startsWith("https://cdn.getbukkit.org/") ||
        url.startsWith("https://download.getbukkit.org/craftbukkit") ||
        url.startsWith("https://cdn.getbukkit.org/spigot");
      if (!url) {
        this.logger.error("Invalid url");
        process.exit(1);
      } else if (!urlCondition) {
        this.logger.error("Invalid url. Must be a getbukkit.org url.");
        process.exit(1);
      }
      {
        this.logger.warn("Using custom url: %s", url);
        return url;
      }
    }
    switch (server.type) {
      case "vanilla":
        const url_vanilla = await this.getVanillaUrl(server.version);
        return url_vanilla;
      case "bukkit":
        return `https://download.getbukkit.org/craftbukkit/craftbukkit-${server.version}.jar`;
      case "spigot":
        return `https://download.getbukkit.org/spigot/spigot-${server.version}.jar`;
      case "paper":
        const url_paper = await this.getPaperUrl(server.version);
        return url_paper;
      case "purpur":
        return `https://api.purpurmc.org/v2/purpur/${server.version}/latest/download`;
      default:
        this.logger.error("Invalid server type: " + server.type);
        process.exit(1);
    }
  }

  public async downloadServer(server: Server): Promise<void> {
    try {
      if (!fs.existsSync(`./${server.name}`))
        fs.mkdirSync(`./${server.name}`, { recursive: true });
      const url = await this.getDownloadUrl(server);
      this.logger.info("Downloading server from %s", url);
      const response = await axios.get(url, {
        responseType: "stream",
      });
      const totalLength = response.headers["content-length"];
      const progressBar = new cliProgress.SingleBar(
        {
          format: "Downloading server [{bar}] {percentage}% | ETA: {eta}s",
        },
        cliProgress.Presets.shades_classic
      );
      progressBar.start(totalLength, 0);
      const writer = fs.createWriteStream(`./${server.name}/server.jar`);
      response.data.on("data", (chunk: any) => {
        progressBar.increment(chunk.length);
      });
      response.data.pipe(writer);
      return new Promise((resolve, reject) => {
        writer.on("finish", () => {
          progressBar.stop();
          resolve();
        });
        writer.on("error", () => {
          progressBar.stop();
          reject();
        });
      });
    } catch (error: any) {
      this.logger.error("Error downloading server: %s", error.message || error);
      this.logger.error(
        "The version does not exists or is not supported by this program."
      );
      if (server.type === "spigot" || server.type === "bukkit") {
        this.logger.error(
          "Due to limitations of getbukkit.org website, we can't download Spigot or Bukkit servers below 1.11 (not included)"
        );
        this.logger.error(
          "If you are trying to download a Spigot or Bukkit server, you can use the Paper server instead."
        );
        this.logger.error(
          "If you want to specify url manually, use the --url option. MUST BE A GETBUKKIT URL. OPTION ONLY AVAILABLE FOR SPIGOT AND BUKKIT SERVERS."
        );
      }
      this.logger.error(
        "If you having issues with the URL provided, please open an issue on GitHub."
      );
      process.exit(1);
    }
  }

  public async downloadPlugin(
    server: Server,
    pluginIdOrUrl: number | string,
    pluginName?: string,
    multipleBar?: cliProgress.MultiBar
  ): Promise<void> {
    if (typeof pluginIdOrUrl == "string") {
      this.logger.info("Downloading plugin from %s", pluginIdOrUrl);
      const response = await axios.get(pluginIdOrUrl, {
        responseType: "stream",
      });
      const totalLength = response.headers["content-length"];
      let progressBar: cliProgress.SingleBar;
      if (multipleBar) {
        progressBar = multipleBar.create(totalLength, 0, null, {
          format: "Downloading plugin [{bar}] {percentage}% | ETA: {eta}s",
        });
      } else {
        progressBar = new cliProgress.SingleBar(
          {
            format: "Downloading plugin [{bar}] {percentage}% | ETA: {eta}s",
          },
          cliProgress.Presets.shades_classic
        );
      }
      if (!progressBar) throw new Error("Unexpected error");
      progressBar.start(totalLength, 0);
      const writer = fs.createWriteStream(
        `./${server.name}/plugins/${
          pluginName ||
          pluginIdOrUrl.split("/")[pluginIdOrUrl.split("/").length - 1]
        }`
      );
      response.data.on("data", (chunk: any) => {
        progressBar.increment(chunk.length);
      });
      response.data.pipe(writer);
      return new Promise((resolve, reject) => {
        writer.on("finish", () => {
          progressBar.stop();
          resolve();
        });
        writer.on("error", () => {
          progressBar.stop();
          reject();
        });
      });
    } else if (typeof pluginIdOrUrl == "number") {
      if (!pluginName) throw new Error("pluginName is required");
      this.logger.info(
        "Downloading plugin from %s",
        `https://api.spiget.org/v2/resources/${pluginIdOrUrl}/download`
      );

      const response = await axios.get(
        `https://api.spiget.org/v2/resources/${pluginIdOrUrl}/download`,
        {
          responseType: "stream",
        }
      );
      const totalLength = response.headers["content-length"];
      let progressBar: cliProgress.SingleBar;
      if (multipleBar) {
        progressBar = multipleBar.create(totalLength, 0, null, {
          format: "Downloading plugin [{bar}] {percentage}% | ETA: {eta}s",
        });
      } else {
        progressBar = new cliProgress.SingleBar(
          {
            format: "Downloading plugin [{bar}] {percentage}% | ETA: {eta}s",
          },
          cliProgress.Presets.shades_classic
        );
      }
      if (!progressBar) throw new Error("Unexpected error");
      progressBar.start(totalLength, 0);
      const writer = fs.createWriteStream(
        `./${server.name}/plugins/${pluginName}`
      );
      response.data.on("data", (chunk: any) => {
        progressBar.increment(chunk.length);
      });
      response.data.pipe(writer);
      return new Promise((resolve, reject) => {
        writer.on("finish", () => {
          progressBar.stop();
          resolve();
        });
        writer.on("error", (e) => {
          progressBar.stop();
          reject(e);
        });
      });
    } else {
      throw new Error("Invalid pluginIdOrUrl type");
    }
  }

  public async downloadPlugins(server: Server): Promise<void> {
    try {
      if (!fs.existsSync(`./${server.name}/plugins`))
        fs.mkdirSync(`./${server.name}/plugins`, { recursive: true });
      const pluginsIdToDownload = [
        57242,
        await this.getLatestGithubRelease("EssentialsX/Essentials"),
        28140,
        34315,
      ];
      const pluginsName = [
        "spark.jar",
        "EssentialsX.jar",
        "LuckPerms.jar",
        "Vault.jar",
      ];
      const multipleBar = new cliProgress.MultiBar(
        {
          format: "Downloading plugins [{bar}] {percentage}% | ETA: {eta}s",
        },
        cliProgress.Presets.shades_classic
      );
      const promises = pluginsIdToDownload.map((id, index) =>
        this.downloadPlugin(server, id, pluginsName[index], multipleBar)
      );
      await Promise.all(promises);
      multipleBar.stop();
    } catch (error: any) {
      this.logger.error(
        "Error downloading plugins: %s",
        error?.message || error
      );
      process.exit(1);
    }
  }
  public async getLatestGithubRelease(repo: string): Promise<string> {
    const response = await axios.get(
      `https://api.github.com/repos/${repo}/releases/latest`
    );
    const version = response.data.tag_name;
    const url = response.data.assets.find(
      (a: any) => a.name === `EssentialsX-${version}.jar`
    ).browser_download_url;
    return url;
  }
}
