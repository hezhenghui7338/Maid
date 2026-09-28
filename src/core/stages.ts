export const STAGE_TAGS = [
  "立项计划",
  "产品调研",
  "产品设计",
  "需求分析",
  "技术设计",
  "技术实现",
  "缺陷管理",
  "上线运营",
  "项目复盘",
] as const;

export function isStageTag(tag: string): boolean {
  return (STAGE_TAGS as readonly string[]).includes(tag);
}
