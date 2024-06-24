import path from "path";
import os from "os";
import { ServerType } from "./types.js";
import fs from "fs";
import Debug from "debug";
const debug = Debug("ezserver:config");

export default class Config {
  private configPath: string;
  private config: ConfigObject;
  constructor() {
    debug("Initializing");
    this.configPath = path.join(os.homedir(), "ezserver.json");
    this.config = {} as ConfigObject;
    debug("Config path: %s", this.configPath);
    if (!fs.existsSync(this.configPath)) {
      debug("Config file not found, creating one");
      fs.writeFileSync(
        this.configPath,
        JSON.stringify({ servers: [] }, null, 2)
      );
    }
    this.load();
  }

  load() {
    try {
      debug("Loading config file");
      this.config = JSON.parse(fs.readFileSync(this.configPath).toString());
    } catch (e) {
      throw new ConfigError(
        "Config file not found or cannot be read",
        ConfigErrorCodes.LOAD_ERROR
      );
    }
  }

  save() {
    debug("Saving config file");
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (e) {
      throw new ConfigError(
        "Error occurred while saving config file",
        ConfigErrorCodes.SAVE_ERROR
      );
    }
  }

  addServer(server: ConfigServer) {
    debug("Adding server %O", server);
    if (this.config.servers.find((s) => s.name === server.name))
      throw new ConfigError(
        "Server with the same name already exists",
        ConfigErrorCodes.SERVER_EXISTS
      );
    if (this.config.servers.find((s) => s.path === server.path))
      throw new ConfigError(
        "Server with the same path already exists",
        ConfigErrorCodes.SERVER_EXISTS
      );
    this.config.servers.push(server);
    this.save();
  }

  removeServer(name: string) {
    debug("Removing server %s", name);
    this.config.servers = this.config.servers.filter((s) => s.name !== name);
    this.save();
  }

  getServer({ name, path }: { name?: string; path?: string }) {
    debug("Getting server %s%s", name + (path ? " " : "") || "", path || "");
    if (name) return this.config.servers.find((s) => s.name === name);
    if (path) return this.config.servers.find((s) => s.path === path);
    return null;
  }

  checkServer(server: ConfigServer): number {
    debug("Checking server %O", server);
    if (this.config.servers.find((s) => s.name === server.name)) return 1;
    if (this.config.servers.find((s) => s.path === server.path)) return 2;
    return 0;
  }

  getServers() {
    return this.config.servers;
  }

  get() {
    return this.config;
  }
}

export type ConfigServer = {
  name: string;
  path: string;
  java: string;
  type: ServerType;
};

export type ConfigObject = {
  servers: ConfigServer[];
};

export class ConfigError extends Error {
  constructor(message: string, public code: ConfigErrorCodes) {
    super(message);
    this.name = "ConfigError";
  }
}

export enum ConfigErrorCodes {
  SERVER_EXISTS,
  SERVER_NOT_FOUND,
  SAVE_ERROR,
  LOAD_ERROR,
}
