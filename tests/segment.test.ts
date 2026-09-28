import { describe, expect, it } from "vitest";
import { segmentMarkdown } from "../src/core/segment";
import { formatHeadingPath } from "../src/core/types";

describe("分段", () => {
  it("SG-01 按标题切开章节", () => {
    const segments = segmentMarkdown("# 立项\n\n第一段说明。\n\n## 范围\n\n第二段说明。\n");
    const paths = segments.map((segment) => formatHeadingPath(segment.headingPath));
    expect(paths).toContain("立项");
    expect(paths).toContain("立项 / 范围");
    expect(segments.some((segment) => segment.text.includes("第一段说明"))).toBe(true);
    expect(segments.some((segment) => segment.text.includes("第二段说明"))).toBe(true);
  });

  it("SG-02 过长章节只在段落之间切开", () => {
    const first = "甲".repeat(12);
    const second = "乙".repeat(12);
    const segments = segmentMarkdown(`# 标题\n\n${first}\n\n${second}\n`, { maxChars: 20 });
    expect(segments).toHaveLength(2);
    expect(segments[0].text).toBe(first);
    expect(segments[1].text).toBe(second);
    expect(segments[0].ordinal).toBe(0);
    expect(segments[1].ordinal).toBe(1);
    expect(formatHeadingPath(segments[0].headingPath)).toBe("标题");
  });

  it("SG-03 代码块保持整块", () => {
    const code = "x".repeat(80);
    const segments = segmentMarkdown(`# 实现\n\n\`\`\`\n${code}\n\`\`\`\n`, { maxChars: 10 });
    expect(segments).toHaveLength(1);
    expect(segments[0].text).toContain(code);
    expect(segments.some((segment) => segment.text === code.slice(0, 40))).toBe(false);
  });

  it("SG-04 表格保持整块", () => {
    const table = ["| 项 | 值 |", "| --- | --- |", "| 一 | 甲 |", "| 二 | 乙 |", "| 三 | 丙 |"].join("\n");
    const segments = segmentMarkdown(`# 对照\n\n${table}\n`, { maxChars: 10 });
    expect(segments).toHaveLength(1);
    expect(segments[0].text).toContain("| 三 | 丙 |");
    expect(segments[0].text).toContain("| 项 | 值 |");
  });

  it("SG-05 任务清单按列表项切开", () => {
    const segments = segmentMarkdown("## 待办\n\n- 补上导出时的文件名\n- 核对删除后的索引\n");
    expect(segments).toHaveLength(2);
    expect(segments[0].text).toContain("补上导出时的文件名");
    expect(segments[0].text).not.toContain("核对删除后的索引");
    expect(segments[1].text).toContain("核对删除后的索引");
    expect(segments[1].text).not.toContain("补上导出时的文件名");
    expect(formatHeadingPath(segments[0].headingPath)).toBe("待办");
  });

  it("SG-06 同输入分段结果稳定", () => {
    const source = "## 待办\n\n- 补上导出时的文件名\n- 核对删除后的索引\n";
    expect(segmentMarkdown(source)).toEqual(segmentMarkdown(source));
  });

  it("SG-07 引用不从中间切开", () => {
    const quote = "> 第一行说明需要保留\n> 第二行说明也要保留";
    const segments = segmentMarkdown(`# 备注\n\n${quote}\n`, { maxChars: 8 });
    expect(segments).toHaveLength(1);
    expect(segments[0].text).toContain("第一行说明需要保留");
    expect(segments[0].text).toContain("第二行说明也要保留");
  });
});
