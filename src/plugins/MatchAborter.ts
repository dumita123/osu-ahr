import { ILobby } from "../ILobby";
import { Player } from "../Player";
import { LobbyPlugin } from "./LobbyPlugin";
import config from "config";
import log4js from "log4js";
import { VoteCounter } from "./VoteCounter";
const logger = log4js.getLogger("matchAborter");

export interface MatchAborterOption {
  vote_rate: number; // アボート投票時の必要数/プレイヤー数
  vote_min: number;　// 最低投票数
  auto_abort_rate: number; // 何割終了したらアボートタイマーを起動するか？
  auto_abort_delay_ms: number; // 試合終了後のアボート実行までの猶予時間
}

const defaultOption = config.get<MatchAborterOption>("MatchAborter");

/**
 * Abort投票を受け付けるためのプラグイン
 * 試合開始直後や終了時に止まってしまった際に復帰するため
 */
export class MatchAborter extends LobbyPlugin {
  option: MatchAborterOption;
  abortTimer: NodeJS.Timer | null = null;
  voting: VoteCounter;

  constructor(lobby: ILobby, option: any | null = null) {
    super(lobby);
    this.option = { ...defaultOption, ...option } as MatchAborterOption;
    this.voting = new VoteCounter(this.option.vote_rate, this.option.vote_min);
    this.registerEvents();
  }

  private registerEvents(): void {
    this.lobby.PlayerLeft.on(p => this.onPlayerLeft(p));
    this.lobby.MatchStarted.on(() => this.onMatchStarted());
    this.lobby.PlayerFinished.on(a => this.onPlayerFinished(a.player, a.score, a.isPassed, a.playersFinished, a.playersInGame));
    this.lobby.MatchFinished.on(() => this.onMatchFinished());
    this.lobby.ReceivedCustomCommand.on(a => this.onCustomCommand(a.player, a.authority, a.command, a.param));
  }

  // 試合中に抜けた場合
  private onPlayerLeft(player: Player): void {
    if (!this.lobby.isMatching) return;
    this.voting.RemoveVoter(player);

    // 母数が減るので投票とタイマーを再評価する
    this.checkVoteCount();
    this.checkAutoAbort();

    // 誰もいなくなったらタイマーを止める
    if (this.lobby.players.size == 0) {
      this.voting.Clear();
      this.stopTimer();
    }
  }

  private onMatchStarted(): void {
    this.voting.RemoveAllVoters();
    for (let p of this.lobby.players) {
      this.voting.AddVoter(p);
    }
  }

  private onPlayerFinished(player: Player, score: number, isPassed: boolean, playersFinished: number, playersInGame: number) {
    this.checkAutoAbort();
  }

  private onMatchFinished() {
    this.stopTimer();
  }

  private onCustomCommand(player: Player, auth: number, command: string, param: string): void {
    if (!this.lobby.isMatching) return;
    if (command == "!abort") {
      if (player == this.lobby.host) {
        logger.trace("host(%s) sent !abort command", player.id);
        this.doAbort();
      } else {
        this.vote(player);
      }
    } else if (auth >= 2) {
      if (command == "*abort") {
        this.doAbort();
      }
    }
  }

  private vote(player: Player) {
    if (this.voting.passed) return;
    if (this.voting.Vote(player)) {
      logger.trace("accept skip request from %s", player.id);
      this.checkVoteCount(true);
    } else {
      logger.trace("vote was ignored");
    }
  }

  // 投票数を確認して必要数に達していたら試合中断
  private checkVoteCount(showMessage: boolean = false): void {
    if (this.voting.count != 0 && showMessage) {
      this.lobby.SendMessage(`bot : match abort progress: ${this.voting.toString()}`)
    }
    if (this.voting.passed) {
      this.doAbort();
    }
  }

  /** 投票の必要数 */
  get voteRequired(): number {
    return Math.ceil(Math.max(
      this.lobby.playersInGame.size * this.option.vote_rate,
      this.option.vote_min));
  }

  private checkAutoAbort(): void {
    if (this.abortTimer == null) {
      if (this.autoAbortRequired <= this.lobby.playersFinished.size) { // 半数以上終了したらタイマー起動
        this.startTimer();
      }
    }
  }

  get autoAbortRequired(): number {
    return Math.ceil(
      this.lobby.playersInGame.size * this.option.auto_abort_rate);
  }

  private doAbort(): void {
    logger.info("do abort");
    this.stopTimer();
    this.lobby.AbortMatch();
  }

  private startTimer(): void {
    if (this.option.auto_abort_delay_ms == 0) return;
    this.stopTimer();
    logger.trace("start timer");
    this.abortTimer = setTimeout(() => {
      logger.trace("abort timer action");
      if (this.abortTimer != null) {
        this.doAbort();
      }
    }, this.option.auto_abort_delay_ms);
  }

  private stopTimer(): void {
    if (this.abortTimer != null) {
      logger.trace("stop timer");
      clearTimeout(this.abortTimer);
      this.abortTimer = null;
    }
  }

  getPluginStatus(): string {
    return `-- Match Aborter --
      timer : ${this.abortTimer != null ? "active" : "---"}
      vote : ${this.voting.toString()}
    `;
  }

  getInfoMessage(): string[] {
    return ["!abort => abort the match. Use if the match stuck."];
  }
}