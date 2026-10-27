# 🎃 万圣节讨糖地图（H5）

搜小区、按「发糖中 / 准备中」筛选附近糖果屋、导航过去、输入暗号打卡收糖、看发糖榜和收获榜；起个昵称就能设置并点亮自己的糖果屋。

线上地址：https://halloween-candy-map.vercel.app

## 目录

```
public/       前端页面（index.html / app.css / app.js）
api/index.js  Vercel 函数入口
lib/core.js   业务逻辑（本地和线上共用）
lib/store.js  存储：线上 Upstash Redis，本地 data.json
server.js     本地运行入口
vercel.json   把 /api/* 转给函数
```

## 本地运行

```bash
node server.js     # http://localhost:3000，数据存在 data.json
```

## 线上环境变量（Vercel 项目 Settings → Environment Variables）

| 变量 | 说明 |
|---|---|
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | 在 Vercel Storage 里连接 Upstash Redis 后自动生成，不用手填 |
| `AMAP_KEY` / `AMAP_SECURITY_CODE` | 高德 Web 端（JS API）Key 和安全密钥 |
| `BAIDU_AK` | 可选，百度地图 JS API GL 的 AK |
| `CHECKIN_RADIUS_M` | 可选，打卡距离限制，默认 300 米 |

改了环境变量后需要重新部署一次才生效。

## 账号

免短信：第一次需要账号时起个昵称即可，账号存在浏览器里。「我的」页面显示 8 位恢复码，换手机或清了浏览器数据时，用恢复码找回。

## 核心规则

- **状态**：点亮且未到开始时间 = 准备中；点亮且在时间段内 = 发糖中；主人点「暂停」时回到准备中；过了结束时间或熄灭后不再显示。
- **打卡**：每个糖果屋有 4 位暗号，只显示在主人页面。同一人同一家每天计 1 次，不能给自己打卡，有定位时需在 300 米内。
- **榜单**：发糖榜按糖果屋收到的打卡数排序，收获榜按用户打卡数排序；次数相同时先打卡的在前。可切换本区 / 全市 / 全国。
- **隐私**：单元和门牌默认不公开，主人勾选后才显示。

## 高德 / 百度

页面地图默认用高德（在百度 App 内打开时用百度，用户可在「我的」里切换）。导航时列出两家，点哪个唤起哪个 App，没装就打开网页版；微信内直接走网页版。
