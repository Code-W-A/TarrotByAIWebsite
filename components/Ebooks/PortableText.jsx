import React from "react";
export function safeLink(url) {
  return typeof url === "string" && /^(https?:\/\/|mailto:)/i.test(url)
    ? url
    : null;
}
export function ebookListNumber(blocks, index) {
  const target = blocks[index];
  if (target?.listItem !== "number") return 0;
  const level = target.level || 1;
  let count = 1;
  for (let n = index - 1; n >= 0; n--) {
    const prior = blocks[n];
    if (!prior.listItem || (prior.level || 1) < level) break;
    if ((prior.level || 1) === level) {
      if (prior.listItem !== "number") break;
      count++;
    }
  }
  return count;
}
export default function PortableText({
  blocks = [],
  fontSize = 18,
  rtl = false,
}) {
  return (
    <div
      dir={rtl ? "rtl" : "ltr"}
      style={{ fontSize, lineHeight: 1.8, overflowWrap: "anywhere" }}
    >
      {blocks.map((block, i) => {
        if (block._type === "image")
          return (
            block.url && (
              <figure key={block._key || i}>
                <img
                  loading="lazy"
                  src={block.url}
                  alt={block.alt || ""}
                  style={{ maxWidth: "100%", height: "auto", borderRadius: 8 }}
                />
                {block.alt && <figcaption>{block.alt}</figcaption>}
              </figure>
            )
          );
        if (block._type !== "block") return null;
        const content = (block.children || []).map((span, j) => {
          if (span._type !== "span") return null;
          let node = span.text;
          for (const mark of span.marks || []) {
            if (mark === "strong") node = <strong>{node}</strong>;
            else if (mark === "em") node = <em>{node}</em>;
            else if (mark === "underline") node = <u>{node}</u>;
            else {
              const link = block.markDefs?.find((d) => d._key === mark);
              const href = safeLink(link?.href);
              if (href)
                node = (
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    {node}
                  </a>
                );
            }
          }
          return <React.Fragment key={span._key || j}>{node}</React.Fragment>;
        });
        if (block.listItem)
          return (
            <div
              key={block._key || i}
              style={{ paddingInlineStart: Math.max(1, block.level || 1) * 18 }}
            >
              {block.listItem === "number"
                ? `${ebookListNumber(blocks, i)}. `
                : "• "}
              {content}
            </div>
          );
        const Tag = ["h2", "h3", "blockquote"].includes(block.style)
          ? block.style
          : "p";
        return <Tag key={block._key || i}>{content}</Tag>;
      })}
    </div>
  );
}
