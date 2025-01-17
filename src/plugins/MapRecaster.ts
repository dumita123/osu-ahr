import { Lobby, Player } from "..";
import { LobbyPlugin } from "./LobbyPlugin";
import { BanchoResponseType } from "../parsers";
import config from "config";

export interface MapRecasterOption {
}



/**
 * ホストが古いバージョンのマップを選択した際に、コマンドでマップを貼り直して最新版にする。
 * !updateコマンドなどで発動。マップ選択後に1度だけ実行できる。
 */
export class MapRecaster extends LobbyPlugin {
  option: MapRecasterOption;
  canRecast: boolean = true;
  constructor(lobby: Lobby, option: Partial<MapRecasterOption> = {}) {
    super(lobby, "MapRecaster", "recaster");
    const d = config.get<MapRecasterOption>(this.pluginName);
    this.option = { ...d, ...option } as MapRecasterOption;
    this.registerEvents();
  }

  private registerEvents(): void {
    this.lobby.ReceivedChatCommand.on(a => this.onReceivedChatCommand(a.command, a.param, a.player))
    this.lobby.ReceivedBanchoResponse.on(a => {
      if (a.response.type == BanchoResponseType.BeatmapChanged) {
        this.canRecast = true;
      }
    });
  }

  private onReceivedChatCommand(command: string, param: string, player: Player): void {
    if (command == "!update") {
      if (this.canRecast) {
        this.canRecast = false;
        this.lobby.SendMessage("!mp map " + this.lobby.mapId);
      }
    }
  }
}