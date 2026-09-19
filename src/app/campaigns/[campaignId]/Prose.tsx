import { Fragment } from "react";
import { parseInlineMarkdown } from "@/lib/dm/inline-markdown";

// Narration with its emphasis rendered: the model's **bold** and *italic*
// as type, not as asterisks. Spans only, so it sits inside any <p>.
export function Prose({ text }: { text: string }) {
  return (
    <>
      {parseInlineMarkdown(text).map((span, index) =>
        span.bold ? (
          <strong key={index} className={span.italic ? "font-semibold italic" : "font-semibold"}>
            {span.text}
          </strong>
        ) : span.italic ? (
          <em key={index}>{span.text}</em>
        ) : (
          <Fragment key={index}>{span.text}</Fragment>
        ),
      )}
    </>
  );
}
