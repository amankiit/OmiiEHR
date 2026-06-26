import { useMemo } from "react";

// Tiny, dependency-free markdown renderer for assistant replies. It builds React
// elements (never raw HTML), so LLM output — which may echo patient free-text — can't
// inject markup. Supports the subset the assistant actually emits: bold/italic/inline
// code, headings, bullet/numbered lists, and GFM pipe tables.

const INLINE = /(\*\*([^*]+)\*\*)|(\*([^*\n]+)\*)|(`([^`]+)`)/g;

const renderInline = (text) => {
  const nodes = [];
  let last = 0;
  let key = 0;
  let m;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1]) nodes.push(<strong key={key++}>{m[2]}</strong>);
    else if (m[3]) nodes.push(<em key={key++}>{m[4]}</em>);
    else if (m[5]) nodes.push(<code key={key++}>{m[6]}</code>);
    last = INLINE.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
};

const isListLine = (line) => /^\s*([-*]|\d+\.)\s+/.test(line);
const isHeading = (line) => /^#{1,6}\s+/.test(line);
const isSeparator = (line) => /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("-");

const splitRow = (line) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

const parseBlocks = (md) => {
  const lines = (md || "").replace(/\r/g, "").split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Table: a row with pipes followed by a separator row.
    if (line.includes("|") && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const tableLines = [];
      while (i < lines.length && lines[i].includes("|")) {
        tableLines.push(lines[i]);
        i += 1;
      }
      const rows = tableLines.map(splitRow);
      blocks.push({ type: "table", header: rows[0], body: rows.slice(2) });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }

    if (isListLine(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items = [];
      while (i < lines.length && isListLine(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !isListLine(lines[i]) &&
      !isHeading(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && isSeparator(lines[i + 1]))
    ) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: "para", lines: para });
  }

  return blocks;
};

const renderBlock = (block, idx) => {
  if (block.type === "heading") {
    return (
      <div key={idx} className={`ai-md-h ai-md-h${block.level}`}>
        {renderInline(block.text)}
      </div>
    );
  }

  if (block.type === "list") {
    const Tag = block.ordered ? "ol" : "ul";
    return (
      <Tag key={idx} className="ai-md-list">
        {block.items.map((item, j) => (
          <li key={j}>{renderInline(item)}</li>
        ))}
      </Tag>
    );
  }

  if (block.type === "table") {
    return (
      <div key={idx} className="ai-md-table-wrap">
        <table className="ai-md-table">
          <thead>
            <tr>
              {block.header.map((cell, j) => (
                <th key={j}>{renderInline(cell)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.body.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c}>{renderInline(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // paragraph — preserve single line breaks within the block
  return (
    <p key={idx} className="ai-md-p">
      {block.lines.map((line, j) => (
        <span key={j}>
          {renderInline(line)}
          {j < block.lines.length - 1 ? <br /> : null}
        </span>
      ))}
    </p>
  );
};

const Markdown = ({ children }) => {
  const blocks = useMemo(() => parseBlocks(children), [children]);
  return <div className="ai-md">{blocks.map(renderBlock)}</div>;
};

export default Markdown;
