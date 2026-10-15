# 完整作答与可复现资料

本目录随Public代码仓库保存，换电脑克隆即可继续，不依赖临时飞书下载链接。

- [Part 1：生产管线](./part-1-pipeline.md)
- [生成调用 JSON Schema](./generation-command.schema.json)
- [Part 2：AR 原型与实测](./part-2-ar-prototype.md)
- [Part 3：20图评分与复核](./part-3-image-review.md)
- [完整 PDF](./output/submission-v2.pdf) / [合并 Markdown](./output/submission-v2.md)
- [原图编号与 SHA-256](./image-manifest.json)
- [原图](./images/) / [打印缩略图](./previews/)
- [验证证据](./evidence/)

原图由题目提供，提交者于2026-10-15明确确认本次公开再分发授权。本仓库不主张原图作者身份，也不代替后续商业使用者完成用途、品牌、文化及授权核验。

主观评分没有伪装成统计真理：提供分项、观察位置、用途假设、条件分数与近分排序敏感性。相同标准下v0.2最佳19/11/03，相对最弱09/16/06；16在确认普通写实用途时才适用2分硬上限。

复现命令从仓库根目录执行：

```bash
npm ci
npm run test:reports
npx playwright install chromium
npm run documents
```

上述PDF构建不访问原始签名链接。不会把模型调试日志、登录信息、个人视频或未经同意的校准数据混入文档。
