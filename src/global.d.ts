declare type ServerType =
  | "vanilla"
  | "bukkit"
  | "spigot"
  | "paper"
  | "purpur"
  | "forge";

declare type MainMenuActions = "create" | "eval" | "exit";

declare type Server = {
  type: ServerType;
  version: string;
  name: string;
  port: number;
};
