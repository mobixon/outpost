/** A line of the log of a game server. */
export interface LogLine {
  /** Grows with every line, so that a listener can skip the lines it has seen. */
  id: number;
  text: string;
}
