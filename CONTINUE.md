# 换电脑继续｜MIMIC v0.2

更新：2026-10-15。此文件是实际工程交接，不是已完成真人验收的声明。

## 1. 一次恢复完整工作

```bash
git clone https://github.com/xieyuh03/mimic-ar-playground.git
cd mimic-ar-playground
npm ci
npm run dev
```

Node.js 要求22.12+。仓库里包括三部分源文档、图片、证据和PDF构建脚本，不依赖原电脑路径或已过期的下载链接。

- 在线版：https://xieyuh03.github.io/mimic-ar-playground/
- 完整PDF：[assignment/output/submission-v2.pdf](./assignment/output/submission-v2.pdf)
- 需求与报告：[assignment/README.md](./assignment/README.md)
- 修改依据：[ITERATION-LOG.md](./ITERATION-LOG.md)

## 2. 当前状态

- 修复低脸颊信号、大笑时微笑系数下降、jawOpen偏低导致持续下雨的问题。
- 嘴部几何已接入实际Worker输出，状态机有独立合成回归，真实主界面有集成测试。
- 微笑/大笑是互斥天气；旧雨、待发烟花和退出后的火箭都有清理规则。
- 视觉从稀疏线段/规则圆环升级为分层雨、错峰烟花、曲线拖尾与碰撞光斑；没有加无限粒子。
- Part 1增加完整逐阶段调用账本与严格Schema分支；Part 3去除未知用途假设扣分并明确条件评分和排序不稳定性。
- 修改后的代码、可编辑稿、原始图集和校验和都以本仓库为准。

## 3. 明天优先做的真人检查

打开在线版后先刷新，确认页脚 `V.02`、存在“学习我的大笑”和灵敏度滑块：

1. 自然表情校准完成，再分别做闭嘴微笑、自然张嘴大笑、说话、打哈欠。
2. 若大笑难触发，先看界面“张嘴系数/嘴部开度/等待原因”；使用“学习我的大笑”，再调灵敏度。不要直接修改一堆全局阈值。
3. 观察下雨→烟花时是否立即停雨；烟花发射后轻移头部，看接触反弹是否与轮廓吻合。
4. 至少在一部iPhone Safari和一部Android Chrome运行5分钟，记录设备/浏览器、光照、校准状态、触发延迟、误触和温升。
5. 收集失败时的**非图像诊断数据**即可；未经同意不要记录或上传摄像头画面。

**仍未宣称完成：** 新版真人精确率/召回率、持续带笑说话区分、弱光侧脸、手机真机长测、3D遮挡。当前30秒性能数据来自桌面Chromium，不是手机成绩。

## 4. 回归与重新出稿

```bash
npm test
npm run test:reports
npm run build
npx playwright install chromium
npm run test:e2e
```

另开终端 `npm run preview`，再执行：

```bash
npm run test:performance
npm run documents
```

性能原始结果在 `reports/performance-v2.json`；浏览器结果在 `reports/browser-results.json`，截图在 `test-results/`。这些运行目录被忽略，需公开的结果应筛选成不含本机路径/敏感信息的摘要放入 `assignment/evidence/`。

文档编辑入口是 `assignment/part-1-pipeline.md`、`part-2-ar-prototype.md`、`part-3-image-review.md`。出稿前先验证Schema、20行算式及200字复盘，再构建PDF。原图在 `assignment/images/`，等比例打印缩略图在 `assignment/previews/`；不要混淆编号01/02或18/19。

## 5. 发布

正常Git环境使用：

```bash
git status
git add <本次实际修改的文件>
git commit -m "Describe the actual change"
git push origin main
```

主分支自动跑测试并发布。查看 [CI](https://github.com/xieyuh03/mimic-ar-playground/actions/workflows/deploy.yml)，确认**当前提交**成功，再匿名打开在线版测试。不要仅凭旧版仍可打开就宣布新版部署成功。

如果只修改文档，仍应执行 `npm run test:reports`；修改Worker时必须重建 `npm run assets`/`npm run build`，只刷新Vite页面不会重建经典Worker。

## 6. 避免回归的约束

- 不恢复cheek硬门槛；不要把jaw百分比改名为“大笑概率”。
- 不让模型推理阻塞主线程，不允许帧队列增长。
- 不用提高粒子上限掩盖视觉设计；保持720/360/180及约250万Canvas像素边界。
- 不拿手动演示或合成回归冒充真人识别测试。
- 不把未说明用途的文字、留白、超现实元素自动判为生成错误。
- 不上传凭据、签名链接、摄像头记录或用户个人校准数据。
