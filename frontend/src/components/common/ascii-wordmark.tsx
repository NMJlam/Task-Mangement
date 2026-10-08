import { cn } from "@/lib/utils";

/**
 * "MAC" in figlet's standard letters. Pure ASCII — slashes, bars, underscores —
 * so it lines up in any monospace font; the box-drawing and block alphabets
 * would pull glyphs from a taller fallback font on Windows and break the art.
 */
const MAC = String.raw` __  __    _    ____
|  \/  |  / \  / ___|
| |\/| | / _ \| |
| |  | |/ ___ \ |___
|_|  |_/_/   \_\____|`;

/**
 * The club's wordmark as a terminal banner. One image to assistive tech, named
 * MAC; the characters are its drawing, not text to read out.
 */
export function AsciiWordmark({ className }: { className?: string }) {
  return (
    <pre
      role="img"
      aria-label="MAC"
      className={cn("font-mono leading-[1.05] whitespace-pre select-none", className)}
    >
      {MAC}
    </pre>
  );
}
