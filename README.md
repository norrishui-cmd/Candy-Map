# 🎃 万圣节讨糖地图（H5）

手机浏览器 / 微信内打开的讨糖地图：搜小区、按「发糖中 / 准备中」筛选附近糖果屋、导航过去、输入暗号打卡收糖、看发糖榜和收获榜；注册后可以设置并点亮自己的糖果屋。

## 目录

```
server.js          后端（Node ≥ 18，零依赖，数据存 data.json）
public/index.html  页面骨架
public/app.css     样式
public/app.js      前端逻辑 + 高德 / 百度 / 演示地图适配层
```

## 本地运行

```bash
node server.js            # 打开 http://localhost:3000
```

没配地图 Key 时会使用内置的演示地图（网格底图），所有流程都能跑通，方便先看效果。

## 配置（环境变量）

| 变量 | 说明 |
|---|---|
| `AMAP_KEY` | 高德 Web 端（JS API）Key，在 lbs.amap.com 控制台申请 |
| `AMAP_SECURITY_CODE` | 高德 Key 对应的安全密钥（2021 年后申请的 Key 必填） |
| `BAIDU_AK` | 百度地图 JavaScript API GL 的 AK，在 lbsyun.baidu.com 申请，白名单填你的域名 |
| `PORT` | 端口，默认 3000 |
| `DATA_FILE` | 数据文件路径，默认 `./data.json` |
| `SMS_MODE` | 设为 `prod` 后不再把验证码返回给前端（上线前务必接短信服务，见下文） |
| `CHECKIN_RADIUS_M` | 打卡时允许的距离，默认 300 米（拿不到定位时只校验暗号） |

```bash
AMAP_KEY=xxx AMAP_SECURITY_CODE=yyy BAIDU_AK=zzz SMS_MODE=prod node server.js
```

## 高德 / 百度如何选择

网页拿不到手机上装了哪些 App，所以按下面的规则处理：

- **页面里显示的地图**：两家都配了 Key 时，在百度 App 内打开用百度，其余情况用高德；只配一家就用那一家。用户可以在「我的 → 地图服务」里手动切换，选择会记住。
- **导航**：点「导航过去」时弹出「高德地图 / 百度地图」两个选项，点哪个就唤起哪个 App；没装会自动转到对应的网页版导航。微信内会拦截 App 跳转，直接打开网页版（网页版里有「打开 App」按钮）。
- 坐标统一以 GCJ-02（高德坐标）存储，百度地图展示时自动转成 BD-09；浏览器定位得到的 WGS-84 也会先转换。

## 核心规则

- **状态**：点亮且未到开始时间 = 准备中；点亮且在时间段内 = 发糖中；主人点「暂停」时回到准备中；过了结束时间或熄灭后不再显示。
- **打卡**：每个糖果屋有 4 位打卡暗号，只显示在主人的「我的糖果屋」页。小朋友到门口问暗号，输入后记一次收获。同一人同一家每天计 1 次，不能给自己打卡，有定位时需在 300 米内。
- **榜单**：发糖榜按糖果屋收到的打卡数排序，收获榜按用户打卡数排序；次数相同时，先打卡的排前面。可切换本区 / 全市 / 全国，区和市取自地图当前位置。
- **隐私**：单元和门牌默认不公开，主人勾选后才显示；手机号只在本人页面以 135****2048 形式出现。

## 上线前要做的事

1. **接短信**：在 `server.js` 的 `POST /api/auth/sms` 里，把生成的 `code` 通过阿里云 / 腾讯云短信发出去，并设置 `SMS_MODE=prod`。
2. **HTTPS**：浏览器定位只在 HTTPS 下可用；高德、百度的 Key 也要把正式域名加进白名单。
3. **反向代理**：放在 Nginx 后面时转发 `X-Forwarded-For`，限流才能按真实 IP 生效。
4. **数据量大时**：`data.json` 适合一个社区或几千户的规模；要做全城活动，把存储换成 SQLite / MySQL（接口不用改）。
5. **备案**：国内服务器 + 域名需要 ICP 备案，微信内打开也要求域名已备案。

## 接口一览

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/config` | 地图 Key 等前端配置 |
| POST | `/api/auth/sms` · `/api/auth/login` · `/api/auth/logout` | 手机号验证码登录 |
| GET | `/api/me` · `/api/me/checkins` | 我的资料、发出/收获次数、收获记录 |
| POST | `/api/me/nickname` | 修改榜单昵称 |
| POST | `/api/house` | 新建或修改我的糖果屋 |
| POST | `/api/house/light` | 点亮 / 熄灭 / 暂停 |
| POST | `/api/house/delete` | 删除糖果屋 |
| GET | `/api/houses?lat&lng&radius&status&q` | 附近糖果屋（或按小区名搜索） |
| GET | `/api/house?id` | 糖果屋详情 |
| POST | `/api/checkin` | 打卡收糖 |
| GET | `/api/rank?type=give\|collect&city&district` | 榜单 |
