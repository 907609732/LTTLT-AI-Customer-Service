// 闪回注入到第三方页面的桥接脚本。**这是本项目唯一允许写 JS 的地方。**
//
// Rust 侧不拼 JS 字符串：它只会调用 `window.__shanhui.handle("<JSON>")`，
// 参数是一段由 serde_json 序列化出来的 JSON 文本。拼出来的 JS 既没法测试也
// 没法审查，而这段代码跑在别人的页面里 —— 跑在一个我们既不拥有、也不能
// 弄坏的运行时里。
//
// # 第一条纪律：能不包装就不包装；必须包装就必须完全透明
//
// 2026-08-26 的探测事故：一个写坏的 WebSocket 猴子补丁丢掉了静态常量
// `WebSocket.OPEN`，页面的连接健康检查因此认为连接从未成功，弹出「连接失败，
// 点击尝试重连」，几分钟内产生 187 次重连。闲鱼的会话功能完全依赖那条
// WebSocket —— 碰坏了，整个平台停摆，而且表现成一个看起来像网络故障的样子。
//
// 由此本文件遵守三条：
//
// 1. **绝不碰 WebSocket。** 我们要的东西（会话列表、消息正文）都不在那里，
//    没有任何理由去动闲鱼的命脉。
// 2. **能改原型方法就不换对象。** `XMLHttpRequest.prototype.open` 是方法替换，
//    静态常量、原型链、`instanceof` 原封不动；换掉 `window.XMLHttpRequest`
//    才是那次事故的形状。
// 3. **每一处替换都配一条自检**，自检失败就**把钩子全部卸掉**并响亮上报。
//    只报警不撤退是不够的 —— 一个把宿主弄坏的工具，第一件事是别再弄坏它。
//
// # 第二条纪律：对话内容不主动出页面
//
// 捕获到的响应体留在页面内存里，只有 Rust 显式发 op 来取时才回传。桥不会自己
// 把聊天记录推过 IPC —— IPC 那头是会进日志的地方。
(function () {
  'use strict';

  // v3（2026-08-30）：页面侧错误改由 `describeError` 统一转文字 —— 在此之前
  // 非 `Error` 的抛出物（mtop 的失败响应就是一个对象）会变成 `[object Object]`，
  // 诊断信息全丢。
  //
  // 这个号只用来**在日志里认出页面跑的是哪一份桥**（`桥接脚本已注入 v=…`），
  // Rust 侧不拿它做任何判断 —— 所以加它是安全的，而看得见「新桥有没有装上」
  // 在排查时值这一行。
  // v4（2026-08-30）：`readTaobaoItemPage` 读之前先滚一遍页面。淘宝商品页是
  // 滚动懒加载的，不滚就读到 0 条属性、0 条尺码 —— 而那两样是千牛这条路最
  // 值钱的产出，且读不到不会报错。
  // v5（2026-08-31）：加 `readSellerTable` / `clickNextPage` / `setPageSize`
  // —— 三个商家后台（抖店/京麦/拼多多）读表格那条路。
  // v6（2026-08-31）：加 `readSellerEditPage` —— 读卖家自己的编辑页。
  // v7（2026-08-31）：加 `clickRowEdit` —— 按商品 id 点那一行的「编辑」。
  // v8（2026-08-31）：`clickRowEdit` 就着点击透传包一层 `window.open` 截地址
  // —— 宿主的新窗口回调对**合成点击**拿不到（弹窗拦截会吞掉它）。
  // v9（2026-08-31）：`readSellerEditPage` 丢掉没有数据行的表格（拼多多那张
  // 只有表头的空模板表），属性名在问号处截断（拼多多的「未找到需要的品牌？
  // 点击申请」）。
  // v10（2026-09-02）：粘性表头把一张表拆成两个 `<table>`（前一张只有
  // 表头、后一张只有数据）时，把表头借给后一张 —— 否则 SKU 行的列名全丢。
  // v16（2026-09-02）：表格上限从 4 张 / 40 行提到 8 张 / 200 行，并把**真实
  // 行数与表数**一起报上去 —— 撞到上限时要能在文字里说明白，否则 AI 会把
  // 一份被截断的规格表当成完整的。
  // v15（2026-09-02）：表格单元格的文本也按可见性过滤（抖店 SKU 图那一格里
  // 有一段只给读屏软件看的拖拽说明）。
  // v14（2026-09-02）：表格的行不再要求在真的 `<tbody>` 里（抖店 SKU 表是
  // 虚拟滚动，行装在一个 `<div class="…tbody-virtual…">` 里）；属性名去掉
  // 开头的必填星号。
  // v13（2026-09-02）：读编辑页之前先展开折叠的属性区（京麦把 6 条类目属性
  // 收在「其他属性 6/6 展开」后面，不点那一下它们根本不在 DOM 里）。
  // v11/v12（2026-09-02）：属性名改成走 `textOutside` —— 跳过值元素、表单
  // 控件、按钮，以及**此刻看不见的东西**。字符串相减在「值是标签子串」
  // （「是否保密发货 否」）与「行里有 `<a>`」两种情形下会静默出错；不按可见性
  // 过滤则会把京麦下拉里的全部候选项当成属性名。三种真机都撞到过。
  // v18（2026-09-02）：为抖店（飞鸽）加七个**可选**画像字段的分支：图片消息
  // 按选择器认（`messageImage`）、消息身份取属性（`messageIdAttr`）、待回复
  // 按计时器文字认（`unreadTextPattern`）、发送键按选择器点（`sendButton`）、
  // 当前买家从输入框 placeholder 读（`activePlaceholderPrefix`）、商品标题从
  // DOM 读（`productTitle`）、发图确认键按选择器点（`selector`）；另加一个
  // `dismissDialogs` op 关推广弹窗。**每个字段空着都走原来的路**，闲鱼一字不变。
  // v19（2026-09-03）：`activateChat` 已停在目标会话上就不点不等；`nickOf`
  // 认画像的 `conversationNick`（抖店取 `title`），形状判据跳过未读数与时间。
  // v20（2026-09-03）：`readChat` 每条消息带 `time`（画像 `messageTime`），
  // 并回报 `typing`（画像 `typingIndicator`）—— 「买家说完了吗」按安静时长判。
  // v21（2026-09-03）：`readChat` 每条消息带 `auto`（画像 `autoMarkers`）——
  // 飞鸽的欢迎语与智能客服回复不再被当成「我方已回」。
  // v22（2026-09-03）：商品标题只认带「用户正在查看商品」字样的卡
  // （`productCard` + `productCardNeedle`）—— 飞鸽的系统提醒卡用同一套类名。
  // v23（2026-09-03）：会话键 = 昵称#头像id（`buyerIdPattern`），发现/切换/读
  // 三处共用 `keyOf`；新 op `activeBuyer` 给切换后「等到真的换过去」用。
  // v24（2026-09-05）：接快手时补的三条，都是通用的：`clickRowEdit` 的
  // 「最内层」按「里面没有同文字后代」判（`span > button > span` 那种结构
  // 原先点到外层 span，点击不会向下传）；`setPageSize` 点不开下拉就补一次
  // mousedown（rc-select 只听 mousedown）；`readSellerEditPage` 认 antd v5
  // 虚拟表的 div 行（整张表没有数据 `tr`），一格里几个输入框就收几个值
  // （尺码表的范围值「80」「100」原先只剩「80」）。
  // v25（2026-09-05）：接小红书时补的，同样通用：行 id 认十六进制（原先只认
  // 纯数字）；图片地址去掉七牛的 `?imageView2/…`；表格格子有输入框但全空
  // 就是空、静态数字优先于输入框（「999」+ 调整量 0 那种格子）；属性名去掉
  // 「1/60」这类字数计数器；自检放过页面自己包装过的 XMLHttpRequest。
  // v26（2026-09-05）：桥自己的定时器改走文档一开始存下的原生函数 ——
  // 快手编辑页把 `setTimeout` 换成了隐藏时不跑的调度器，布防的事件永远推不出去。
  // v27（2026-09-05）：接快手客服工作台：`write` / `inputValue` 认 contenteditable
  // 富文本输入框（Quill）；`pendingChats` 可以按会话所在的**分组**认待办。
  // v28（2026-09-05）：`pasteImage` 可以走页面的「图片」按钮 + 截住它唤起的
  // file input（画像 `image_pick_button`）—— 快手不吃 paste 也不吃拖放。
  // v30（2026-09-05）：`pasteImage` 可以往页面**现成的** file input 里塞文件
  // （画像 `image_file_input`，小红书千帆）；每条消息的时刻可以从属性读
  // （画像 `message_time_attr`，毫秒 epoch）。
  // v31（同日）：`buyerIdAttr` 配了而 `buyerIdPattern` 没配时，**整个属性值
  // 就是买家 id**，并且认会话项自己身上那一份（小红书的 `data-key`）。
  // v32（同日）：`readiness` 多报一个 `loggedOutVisible`（画像
  // `logged_out_needles`）—— 未登录时地址不跳转、只弹框的平台（小红书千帆）
  // 需要它，否则会被当成掉线。
  // v33（2026-09-05）：可见性判据从「有矩形」升级为 `trulyVisible`（连祖先
  // 链上的 opacity/visibility/display 一起看）—— 卡在消失动画里的弹窗有矩形
  // 但看不见，旧判据会去点它并报「已点」。
  // v39（2026-09-10）：加 `sessionState` —— 「接口没落地」时页面到底是什么
  // 状态，此前无从判断，只能把平台那句假的「接口超时」原样端给商家。
  // v52（2026-09-19）：认**商品卡片消息**。此前它两类都不匹配，整条被丢掉
  // （闲鱼更糟：被当成买家发的图片）。见画像 `message_product_card`。
  // v53（2026-09-23）：`activeBuyer` 认**聊天区里的昵称**（画像 `pane_nick`），
  // 会话列表选中项只做核对；两边对不上报 `count: -2`（正在切换），不再报
  // 「没点开会话」。闲鱼列表一重排就有一两秒选中项是 0 或 2 个，而顶栏
  // 从没闪过（真机录像）。
  // v54（2026-09-23）：`pane_id_attr` —— 会话 id 从聊天区里每条消息身上读
  // （小红书 `data-chat-id`），与列表选中项的 id 核对，对不上报 -2。
  // v55（2026-09-23 复核）：列表里**一个选中项都没有**（被滚走、虚拟列表没
  // 渲染它）时信聊天区，不再报 -2；小红书没有消息时会话 id 先从唯一的选中项取。
  // v56（2026-10-05）：`readiness` 认得出更多「没登录」。看得见画像
  // `logged_out_selector` 那个元素也算（闲鱼的登录框是跨域 iframe，弹窗里
  // 一个字都读不到）；不在聊天页上时 `logged_out_needles` 也在整页里找（抖店
  // 那句「登录已过期」不在任何弹窗里）；另报 `loginCookieMissing` 与
  // `conversationCount`，给闸门「列表空 + 登录 cookie 不在」那一条用。
  // v57（2026-10-12）：加 `cookieValue` —— 千牛读清单时取卖家中心登录的是哪个
  // 店铺账号（画像 `seller_cookie`），给商品记上来源店铺。
  // v58（2026-11-09）：拼多多接待。`readChat` / `pendingChats` 在画像
  // `chatStore: "pdd"` 时**先读页面自己的会话数据**（Vue 仓库，只读），读不到
  // 才走 DOM；`commit` 多一个 `enter`（拼多多的发送键只认真人点击，回车不查）；
  // 加 `pddSendText`（回车失效时的接口后备）。见各处注释。
  // v59（2026-11-11）：抖店三处。① 聊天里的 `.chatd-card` 以**价格**为锚取商品名
  // （画像 `message_product_card_price`），没有价格的卡不当商品卡 —— 原来取卡里第一行
  // 字，取到的总是抬头（「来自电商小助手的推荐」「地址修改成功」）。② 咨询商品接口的
  // 回包只认**最近一次切会话之后**到的（`activateChat` 记下切换时刻），之前那份可能是
  // 上一位买家的。③ 加 `restoreProductPanel`：发完商品卡把右侧面板切回「订单」，
  // 那个接口是右侧「咨询宝贝」那块在调的，停在「商品」页签上它就不再刷新。
  var V = 59;

  // 这一份桥是什么时候装上的。**用来判断「页面真的换了一个文档」**：
  // 导航或刷新之后整个 IIFE 会重跑，这个值随之改变。
  //
  // 只看 `href` 是不够的 —— 刷新前后 href 一模一样，而我们恰恰需要区分
  // 「还是刚才那个文档」与「已经重新加载完了」。
  var INSTALLED_AT = Date.now();

  // **原生的定时器，在页面自己的脚本跑起来之前先存一份。**
  //
  // v26（2026-09-05）：快手的商品编辑页把 `window.setTimeout` 换成了自己的
  // 调度器（打印出来照样是 `[native code]`，绑定过的函数都这样），而它在
  // 隐藏的页面里**根本不跑**：布防那边「发现表单、排下 1.5 秒后推事件」
  // 之后，那个回调 28 秒都没执行，对 body 的自测同样等不到。这段脚本是
  // 文档一开始就注入的，此刻这几样还是原生的 —— 存下来，桥自己的定时全走
  // 这份，页面之后怎么换都与我们无关。**不改页面的**，只是不用它的。
  var NATIVE = {
    setTimeout: window.setTimeout,
    setInterval: window.setInterval,
    clearInterval: window.clearInterval
  };
  function later(fn, ms) { return NATIVE.setTimeout.call(window, fn, ms); }
  function every(fn, ms) { return NATIVE.setInterval.call(window, fn, ms); }
  function stopEvery(id) { NATIVE.clearInterval.call(window, id); }

  // initialization_script 每次导航都会重新执行（实测确认）。同一个文档里重复
  // 安装会把钩子叠起来，而叠起来的钩子正是这类事故的放大器。
  if (window.__shanhui && window.__shanhui.v === V) { return; }

  var MAX_BODY = 512 * 1024;   // 单份响应保留上限
  var MAX_KEPT = 8;            // 保留的接口份数上限

  // 只留这几个接口的响应。名单之外一律不留 —— 不是为了省内存，是为了让
  // 「我们究竟把什么留在了内存里」这个问题有一个能一眼看完的答案。
  var KEEP = [
    'mtop.taobao.idlemessage.pc.session.sync',
    'mtop.idle.trade.pc.message.headinfo',
    'mtop.taobao.idlemessage.pc.loginuser.get',
    'mtop.taobao.idlemessage.pc.redpoint.query',
    // 抖店：这个买家咨询过哪几件商品。**飞鸽的商品 id 只在这里**——
    // 聊天里那张「用户正在查看商品」的卡片 DOM 里只有标题，没有任何 id
    // （2026-09-18 真机）。而标题在同店同名不同规格的商品之间分不开。
    'workstation/get_consulting_products'
  ];

  var ops = {};        // op 名 -> 处理函数
  var kept = {};       // 接口名 -> { at, body }
  // 最近一次由我们切会话的时刻（v59，`activateChat`）。抖店咨询商品接口的回包只认
  // 这之后到的，见 `productFromConsulting`。商家自己点的切换我们不知道，那时这里还是
  // 上一次的值 —— 他点过去之后页面调的那一次照样晚于它，照收。
  var lastSwitchAt = 0;
  var installed = [];  // 卸载函数，自检失败时倒序执行
  var disabled = null; // 非 null = 钩子已因自检失败卸掉，值是原因

  function post(msg) {
    try {
      window.ipc.postMessage(JSON.stringify(msg));
    } catch (e) {
      // IPC 不通就什么都做不了了。**绝不能把异常抛回页面** —— 我们是客人。
    }
  }

  function alarm(what) {
    // 自检失败：先卸钩子，再上报。顺序很重要 —— 一个把宿主弄坏的工具，
    // 第一件事是别再弄坏它。
    if (disabled === null) {
      disabled = what;
      for (var i = installed.length - 1; i >= 0; i--) {
        try { installed[i](); } catch (e) { /* 卸载失败也不能抛 */ }
      }
      installed = [];
    }
    post({ kind: 'alarm', reason: what });
  }

  // ---- 宿主健康自检 -------------------------------------------------------
  //
  // 每条都对应一种「包装漏掉了某个面」的具体形状。教训不是「小心点」，是
  // **默认你会漏掉某个面** —— 逐个记得是不可靠的策略，所以把它写成断言。
  function healthProblems() {
    var bad = [];
    try {
      if (typeof window.fetch !== 'function') { bad.push('fetch 不再是函数'); }
      if (XMLHttpRequest.UNSENT !== 0 || XMLHttpRequest.DONE !== 4) {
        bad.push('XMLHttpRequest 的静态常量丢了');
      }
      // v25（2026-09-05）：**页面自己把 `window.XMLHttpRequest` 换成包装器**的
      // 情形要放过。小红书商家后台就是这样（构造函数是 `function(){var t=new n,
      // …return t}`，返回的是原生实例）—— 拿包装器做 `instanceof` 必然是 false，
      // 而那不是我们弄坏的。原生实例一定是 `XMLHttpRequestEventTarget` 的实例，
      // 两个都不是才算真的坏了（我们那次事故的形状是**换掉对象**，静态常量那
      // 一条仍然会抓到它）。
      var probe = new XMLHttpRequest();
      if (!(probe instanceof XMLHttpRequest) &&
          !(typeof XMLHttpRequestEventTarget === 'function' && probe instanceof XMLHttpRequestEventTarget)) {
        bad.push('XMLHttpRequest 的 instanceof 不成立');
      }
      // 我们不碰 WebSocket，但仍然检查它 —— 187 次重连那次就是死在这上面，
      // 而破坏者未必是我们（页面自己的其他扩展、以后的我们）。
      if (typeof WebSocket === 'function' && WebSocket.OPEN !== 1) {
        bad.push('WebSocket.OPEN 被破坏了（这正是 187 次重连事故的形状）');
      }
    } catch (e) {
      bad.push('自检本身抛异常：' + String(e && e.message));
    }
    return bad;
  }

  function selfCheck() {
    var bad = healthProblems();
    if (bad.length > 0) { alarm(bad.join('；')); }
    return bad;
  }

  // ---- 捕获页面自己发的 MTop 响应 -----------------------------------------
  //
  // 「借用页面已经建立的调用能力」：闲鱼的 MTop 网关要求签名（_m_h5_tk token、
  // sign = MD5(...)），自己实现意味着逆向签名算法、管 token 刷新、每次阿里
  // 轮换就挂。而页面自己发的请求，这些全由它自己的运行时处理。
  //
  // 我们只在旁边听：**不改请求、不吞响应、不延迟**。
  function apiNameOf(url) {
    if (typeof url !== 'string') { return null; }
    for (var i = 0; i < KEEP.length; i++) {
      if (url.indexOf(KEEP[i]) !== -1) { return KEEP[i]; }
    }
    return null;
  }

  function keep(api, text) {
    if (!api || typeof text !== 'string') { return; }
    if (text.length > MAX_BODY) { return; }
    if (!Object.prototype.hasOwnProperty.call(kept, api) &&
        Object.keys(kept).length >= MAX_KEPT) {
      return;
    }
    kept[api] = { at: Date.now(), body: text };
  }

  function installFetchHook() {
    var orig = window.fetch;
    if (typeof orig !== 'function') { return; }
    function shanhuiFetch(input, init) {
      var url = typeof input === 'string' ? input : (input && input.url);
      var api = apiNameOf(url);
      var watched = armedMatches(url);
      var body = init && typeof init.body === 'string' ? init.body : null;
      var p = orig.apply(this, arguments);
      if (!api && !watched) { return p; }
      return p.then(function (res) {
        // clone() 之后读副本：**绝不读原响应的 body**，那会把它消耗掉，
        // 页面就再也读不到自己的数据了。
        try {
          res.clone().text().then(
            function (t) {
              if (api) { keep(api, t); }
              if (watched) { noteArmed(url, body, t); }
            },
            function () { /* 读副本失败，静默 */ }
          );
        } catch (e) { /* clone 失败，静默 —— 观察者不改变被观察者 */ }
        return res;
      });
    }
    window.fetch = shanhuiFetch;
    installed.push(function () { window.fetch = orig; });
  }

  function installXhrHook() {
    // 改原型方法，不换 window.XMLHttpRequest —— 后者才是那次事故的形状。
    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;
    if (typeof origOpen !== 'function' || typeof origSend !== 'function') { return; }

    XMLHttpRequest.prototype.open = function (method, url) {
      try {
        this.__shanhuiApi = apiNameOf(url);
        // 布防中的片段要连 URL 一起留着 —— 重放要的接口名、版本、参数全在
        // 请求里，而 `send` 那头已经看不到 URL 了。
        this.__shanhuiUrl = typeof url === 'string' ? url : null;
      } catch (e) { /* 只读属性等，忽略 */ }
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      var self = this;
      var watched = armedMatches(self.__shanhuiUrl);
      var sent = typeof body === 'string' ? body : null;
      if (self.__shanhuiApi || watched) {
        // 被动监听，不替换 onreadystatechange —— 那会把页面自己的回调顶掉。
        try {
          self.addEventListener('load', function () {
            try {
              if (self.responseType === '' || self.responseType === 'text') {
                if (self.__shanhuiApi) { keep(self.__shanhuiApi, self.responseText); }
                if (watched) { noteArmed(self.__shanhuiUrl, sent, self.responseText); }
              }
            } catch (e) { /* 跨域等，静默 */ }
          });
        } catch (e) { /* 忽略 */ }
      }
      return origSend.apply(this, arguments);
    };
    installed.push(function () {
      XMLHttpRequest.prototype.open = origOpen;
      XMLHttpRequest.prototype.send = origSend;
    });
  }

  // ---- op 派发 ------------------------------------------------------------
  //
  // 每次调用**必须恰好回一次**。回零次 = 调用方等到超时（一个店铺停摆一整轮）；
  // 回两次 = 第二次的 id 已经不在登记里，被丢掉 —— 看起来正常，掩盖了缺陷。
  // 把页面侧抛出来的东西变成**人能读的一句话**。
  //
  // # 这里一度是 `String(payload)`，而那会毁掉大部分诊断信息
  //
  // 页面上抛出来的常常**不是 `Error`**：mtop 失败时 reject 的是一个响应对象
  // （`{ret:["FAIL_SYS_TOKEN_EXPIRED::令牌过期"], …}`），而 `String({})` 的
  // 结果是 `[object Object]`。
  //
  // 于是 2026-08-30 真机上那条「详情接口没通」带回来的全部信息就是
  // `页面侧报错：[object Object]` —— 而 `ret` 里那句话恰恰是唯一能说明
  // 真因的东西（是登录过期？被反爬挡了？还是接口改名了？三种处置完全不同）。
  //
  // **一条读不懂的错误信息等于没有错误信息**，而没有错误信息时人就会去猜。
  //
  // 截断到 300 字：够放下 `ret` 和几个字段，又不至于把一整份响应体搬过 IPC
  // （文件头第二条纪律）。
  function describeError(e) {
    if (e === null || e === undefined) { return '(页面侧抛出了空值)'; }
    if (typeof e === 'string') { return e; }
    // `instanceof Error` 在跨 realm 时会失效（iframe 里造的 Error），
    // 所以按鸭子类型认。
    if (e && typeof e.message === 'string' && typeof e.name === 'string') {
      return e.name + ': ' + e.message;
    }
    try {
      var s = JSON.stringify(e);
      if (typeof s === 'string' && s !== '{}' && s !== 'null') {
        return s.length > 300 ? s.slice(0, 300) + '…(已截断)' : s;
      }
    } catch (x) {
      // 循环引用之类。往下走兜底。
    }
    // 连 JSON 都序列化不了（多半是个宿主对象）。**至少说出它是什么**，
    // 别再回一句 `[object Object]`。
    var keys = '';
    try { keys = Object.keys(e).slice(0, 8).join(','); } catch (x2) { /* 也读不了 */ }
    return '无法序列化的对象' + (keys ? '（字段：' + keys + '）' : '') + ' ' + String(e);
  }

  function reply(id, ok, payload) {
    if (ok) {
      var data = JSON.stringify(payload === undefined ? null : payload);
      post({ kind: 'reply', id: id, ok: true, data: data });
    } else {
      post({ kind: 'reply', id: id, ok: false, err: describeError(payload) });
    }
  }

  function handle(raw) {
    var req = null;
    try {
      req = JSON.parse(raw);
    } catch (e) {
      post({ kind: 'alarm', reason: '收到无法解析的调用：' + String(e && e.message) });
      return;
    }
    var id = req && req.id;
    if (typeof id !== 'number') {
      post({ kind: 'alarm', reason: '收到没有 id 的调用 —— 无法回复' });
      return;
    }
    var fn = ops[req.op];
    if (typeof fn !== 'function') {
      reply(id, false, '页面侧不认识这个操作：' + String(req.op) +
        '（桥版本 v' + V + '，已注册：' + Object.keys(ops).join(',') + '）');
      return;
    }
    var done = false;
    function once(ok, payload) {
      if (done) { return; }
      done = true;
      reply(id, ok, payload);
    }
    try {
      var r = fn(req.args || {});
      if (r && typeof r.then === 'function') {
        r.then(
          function (v) { once(true, v); },
          // **原样交给 `describeError`。** 这里一度写 `(e && e.message) || e`
          // —— 那是第二份「错误怎么变成文字」的规则，而且是有损的：
          // 没有 `message` 的对象会原样落到 `String()` 上，变成
          // `[object Object]`。一处决定就够了。
          function (e) { once(false, e); }
        );
      } else {
        once(true, r);
      }
    } catch (e) {
      // 页面里跑的是别人的代码，随时可能变。抛出去只会污染宿主，而调用方
      // 那头会一直等到超时 —— 两头都变差。
      once(false, e);
    }
  }

  // ---- 内置 op ------------------------------------------------------------

  // 探活：宿主用它确认脚本真的注入进来了，以及宿主页面是否仍然健康。
  ops.ping = function () {
    return {
      v: V,
      href: location.href,
      installedAt: INSTALLED_AT,
      ready: document.readyState,
      hooksDisabled: disabled,
      problems: healthProblems(),
      captured: Object.keys(kept)
    };
  };

  // 页面此刻长什么样。**只在采集出错时调**，给日志用。
  //
  // v25（2026-09-05）：快手的编辑页在隐藏的详情 webview 里 30 秒没渲染出
  // 表单，而日志里只有一句「找不到」—— 它到底是停在登录页、停在一张空白
  // 骨架、还是渲染出了另一种形状，无从判断。正文只取前 300 字，商品编辑
  // 页上没有对话内容。
  // 页面里各类任务还活不活：定时器、rAF、MessageChannel、微任务。
  //
  // 每次调 `pageGlance` 都各排一个，把**上一次**排下的有没有跑到记下来 ——
  // 隔一会儿再调一次就知道谁被冻住了。2026-09-05 快手编辑页：定时器回调
  // 30 秒不跑而 MutationObserver 正常，这是分清「哪一类任务源被冻结」的
  // 唯一办法。
  var taskProbe = { at: 0, timer: 0, raf: 0, channel: 0, micro: 0 };
  function armTaskProbe() {
    var mark = Date.now();
    taskProbe.at = mark;
    try { later(function () { taskProbe.timer = Date.now(); }, 0); } catch (e) { /* 排不上就记不到 */ }
    try { window.requestAnimationFrame(function () { taskProbe.raf = Date.now(); }); } catch (e) { /* 同上 */ }
    try {
      var ch = new MessageChannel();
      ch.port1.onmessage = function () { taskProbe.channel = Date.now(); };
      ch.port2.postMessage(1);
    } catch (e) { /* 同上 */ }
    try { Promise.resolve().then(function () { taskProbe.micro = Date.now(); }); } catch (e) { /* 同上 */ }
  }
  function taskProbeReport() {
    function ago(t) { return t >= taskProbe.at && taskProbe.at > 0 ? (t - taskProbe.at) + 'ms' : 'no'; }
    return { since: taskProbe.at ? (Date.now() - taskProbe.at) + 'ms' : 'never', timer: ago(taskProbe.timer), raf: ago(taskProbe.raf), channel: ago(taskProbe.channel), micro: ago(taskProbe.micro) };
  }

  ops.pageGlance = function (args) {
    var a = args || {};
    var probe = taskProbeReport();
    armTaskProbe();
    if (a.probeOnly) { return { href: location.href, visibility: document.visibilityState, tasks: probe }; }
    var body = '';
    try { body = (document.body && document.body.innerText) || ''; } catch (e) { /* 读不到就空 */ }
    // 输入框长什么样：类名 + 占位符，去重取前 12 种。**画像里的选择器没命中时，
    // 这就是「页面上到底是什么类名」的答案** —— 同一个地址在不同环境里可能
    // 下发不同的前端构建。
    var seen = {};
    var samples = [];
    var inputs = document.querySelectorAll('input, textarea');
    for (var i = 0; i < inputs.length && samples.length < 12; i++) {
      var el = inputs[i];
      var key = String(el.className || '').slice(0, 60) + '|' + String(el.getAttribute('placeholder') || '').slice(0, 30);
      if (seen[key]) { continue; }
      seen[key] = true;
      samples.push({ cls: String(el.className || '').slice(0, 60), ph: String(el.getAttribute('placeholder') || '').slice(0, 30), id: String(el.id || '').slice(0, 30), val: String(el.value || '').slice(0, 20) });
    }
    // 调用方关心的那几条选择器各命中几个。语法错的记 -1。
    var hits = {};
    var ask = a.selectors || {};
    for (var k in ask) {
      if (!Object.prototype.hasOwnProperty.call(ask, k)) { continue; }
      try { hits[k] = document.querySelectorAll(String(ask[k])).length; } catch (e) { hits[k] = -1; }
    }
    // 页面有没有动过我们赖以推事件的那几样东西。
    function isNative(f) { try { return String(f).indexOf('[native code]') !== -1; } catch (e) { return false; } }
    var env = {
      setTimeoutNative: isNative(window.setTimeout),
      setIntervalNative: isNative(window.setInterval),
      timerWrapped: window.setTimeout !== NATIVE.setTimeout || window.setInterval !== NATIVE.setInterval,
      mutationObserverNative: isNative(window.MutationObserver),
      ipc: (function () { try { return typeof window.ipc + '/' + typeof (window.ipc && window.ipc.postMessage); } catch (e) { return 'err'; } })(),
      hooksDisabled: disabled
    };
    var ws = {};
    for (var wn in recentWatches) {
      if (Object.prototype.hasOwnProperty.call(recentWatches, wn)) {
        var st = recentWatches[wn];
        ws[wn] = { ageMs: Date.now() - st.armedAt, lastCount: st.lastCount, fired: st.fired, posted: st.posted, checks: st.checks, stillArmed: !!watches[wn] };
      }
    }
    return {
      href: location.href,
      title: document.title,
      ready: document.readyState,
      visibility: document.visibilityState,
      inputs: inputs.length,
      inputSamples: samples,
      hits: hits,
      env: env,
      watches: ws,
      tasks: probe,
      text: body.replace(/\s+/g, ' ').slice(0, 300)
    };
  };

  // 就绪探测。**只回布尔与地址，一个字的对话内容都不回。**
  //
  // 这个 op 每 3 秒被调一次，结果会进日志。让聊天记录以那个频率流进日志文件
  // 是不可接受的 —— 所以文字匹配在页面内部完成，出去的只有「有/没有」。
  ops.readiness = function (args) {
    var a = args || {};
    var chatArea = exists(a.chatArea);
    // v36：**「已经进到聊天页了」的锚点**，与 `chatArea` 分开。
    //
    // `chatArea` 还兼着「读消息时遍历的根」，多数平台一个选择器够用；
    // 抖店的是 `.messageList`，那只有点开会话才有。空则退回 `chatArea`。
    //
    // v35 曾经改成数会话列表的项数，那条判据不成立：空闲时列表本来就是
    // 空的（页面上写着「暂无会话中用户」），最常见的状态下恰好判错。
    var chatPage = a.chatPage ? exists(a.chatPage) : chatArea;
    return {
      href: location.href,
      documentReady: document.readyState === 'complete',
      // v38：原样带回去，进「就绪状态变化」那行日志。`documentReady` 为假时
      // 光知道「没加载完」不够 —— 停在 interactive 几分钟和 loading 是两回事。
      readyState: String(document.readyState),
      problems: healthProblems(),
      chatAreaPresent: chatArea,
      chatPagePresent: chatPage,
      activeCount: (a.activePlaceholderPrefix || a.paneNick)
        ? activeBuyer(a.conversationActive, { input: a.input, prefix: a.activePlaceholderPrefix }, a.conversationNick, a).count
        : countOf(a.conversationActive),
      verificationVisible: dialogMentions(a.dialogRoots, a.verificationNeedles),
      // v32：**弹窗里说「你没登录」**（画像 `logged_out_needles`）。它必须与
      // 掉线分开报：小红书千帆未登录时地址**不跳转**（还停在工作台那一页），
      // 弹一个「登录认证已过期，请重新登录！」，同时页顶写着「连接失败，
      // 点击刷新」。按地址判登录态在这里不成立，而把它当掉线的后果是对着
      // 商家说「请检查网络或点重连」—— 他网络好得很，怎么点都没用。
      //
      // v56：另外两种说法也算。**看得见画像 `loggedOutSelector` 那个元素**
      // —— 闲鱼没登录时登录框是一个跨域 iframe（passport），外面那层弹窗的
      // innerText 是空的，按字找一个字都找不到。**不在聊天页上时整页找那些
      // 字样** —— 抖店没登录时地址不跳，那句「登录已过期」写在页面中间，
      // 不在任何弹窗里。只在不在聊天页上时找整页：聊天页上满是买家的话，
      // 买家打一句「登录已过期怎么办」不该把店铺判成没登录。
      loggedOutVisible: dialogMentions(a.dialogRoots, a.loggedOutNeedles) ||
        anyTrulyVisible(a.loggedOutSelector) ||
        (!chatPage && !chatArea && pageMentions(a.loggedOutNeedles)),
      // v56：画像配了登录 cookie 而它不在。**闸门只拿它做佐证**（要会话列表
      // 也是空的才算没登录），理由见 Rust 侧 `ChatProfile::login_cookie`。
      loginCookieMissing: a.loginCookie ? !hasCookie(String(a.loginCookie)) : false,
      conversationCount: countOf(a.conversationItem),
      disconnectedVisible: dialogMentions(a.dialogRoots, a.disconnectedNeedles),
      loggedInApiSeen: Object.keys(kept).length > 0
    };
  };

  // 这条选择器有没有命中一个**真的看得见**的元素。空 = 不看。
  //
  // 不合法与 `exists` 一样抛出：写错的配置不能表现成「页面上没有这个东西」。
  function anyTrulyVisible(selector) {
    if (typeof selector !== 'string' || selector === '') { return false; }
    var nodes;
    try {
      nodes = document.querySelectorAll(selector);
    } catch (e) {
      throw new Error('选择器 ' + selector + ' 不合法：' + String(e && e.message));
    }
    for (var i = 0; i < nodes.length; i++) {
      if (trulyVisible(nodes[i])) { return true; }
    }
    return false;
  }

  // 整页文字里有没有这些字样。**只给「不在聊天页上」那一档用**，理由见
  // `readiness` 里用它的那一行。那时页面多半很短（抖店没登录时整页三百来字），
  // 取一次 innerText 的代价可以忽略。
  function pageMentions(needles) {
    if (!Array.isArray(needles) || needles.length === 0) { return false; }
    var text = '';
    try { text = String((document.body && document.body.innerText) || '').slice(0, 20000); } catch (e) { return false; }
    for (var i = 0; i < needles.length; i++) {
      var n = needles[i];
      if (typeof n === 'string' && n !== '' && text.indexOf(n) !== -1) { return true; }
    }
    return false;
  }

  // 有没有这个名字的 cookie（`document.cookie` 看得见的那些）。
  //
  // 前后都带分隔符再找，`unb` 才不会命中 `last_unb` 这类名字。
  function hasCookie(name) {
    if (!name) { return false; }
    var all = '; ' + String(document.cookie || '') + ';';
    return all.indexOf('; ' + name + '=') !== -1;
  }

  // 关掉推广弹窗。**只在弹窗容器里找、文字全等才点**，一次最多三个。
  //
  // 飞鸽一进聊天页就弹「智能客服服务协议」推广，按钮叫「关闭弹窗」；不关
  // 掉它，整个会话区根本不渲染。要点什么字由画像给（`chat_dismiss_texts`），
  // 这里只执行；找不到就什么都不做 —— 它是顺手的事，不是判据。
  ops.dismissDialogs = function (args) {
    var a = args || {};
    var texts = Array.isArray(a.texts) ? a.texts : [];
    var dismissed = [];
    if (!texts.length || !a.roots) { return { dismissed: dismissed }; }
    var roots;
    try { roots = document.querySelectorAll(a.roots); } catch (e) {
      throw new Error('弹窗容器选择器不合法：' + String(e && e.message));
    }
    for (var r = 0; r < roots.length && dismissed.length < 3; r++) {
      if (!roots[r].getClientRects || roots[r].getClientRects().length === 0) { continue; }
      for (var t = 0; t < texts.length && dismissed.length < 3; t++) {
        var btn = clickableWithText(roots[r], texts[t]);
        if (!btn) { continue; }
        try { btn.click(); dismissed.push(texts[t]); } catch (e2) { /* 关不掉就算了 */ }
      }
    }
    return { dismissed: dismissed };
  };

  // 店铺名。**读不到就是 null，不抛错** —— 它只用来显示，任何一种读不到
  // 都不该妨碍接待（没登录、页面没加载完、平台改版）。
  ops.shopName = function (args) {
    var sel = (args || {}).selector;
    if (typeof sel !== 'string' || sel === '') { return null; }
    try {
      var list = document.querySelectorAll(sel);
      // v38：**只认页面顶部、可见的那一个。** 店铺名 / 当前账号名永远在
      // 页头（闲鱼右上角 y≈26，飞鸽左上角 y≈56）；同一条选择器在页面
      // 下方可能还命中别的东西（会话列表里的头像、消息区顶部的买家名），
      // 它们都在 140px 以下。找不到顶部那一个就当没读到 —— 宁可不显示。
      var el = null;
      for (var i = 0; i < list.length; i++) {
        var r = list[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.top >= 0 && r.top < 140) { el = list[i]; break; }
      }
      if (!el) { return null; }
      // title 优先：好几个平台把完整店名放在 title 上，可见文本是截断过的。
      // 其次 alt：飞鸽的账号名只写在左上角头像的 alt 上（2026-09-07 真机）。
      var t = (el.getAttribute && el.getAttribute('title')) || (el.getAttribute && el.getAttribute('alt')) || el.textContent || '';
      t = String(t).replace(/\s+/g, ' ').trim();
      return t === '' ? null : t;
    } catch (e) { return null; }
  };

  function countOf(selector) {
    if (typeof selector !== 'string' || selector === '') { return -1; }
    try { return document.querySelectorAll(selector).length; } catch (e) { return -1; }
  }

  function exists(selector) {
    if (typeof selector !== 'string' || selector === '') { return false; }
    try {
      return document.querySelector(selector) !== null;
    } catch (e) {
      // 选择器语法错误。**不能当成「没找到」** —— 那会让一个写错的配置
      // 表现成「页面上没有这个东西」，而两者的修法完全不同。
      throw new Error('选择器 ' + selector + ' 不合法：' + String(e && e.message));
    }
  }

  // 真的看得见吗。**几何尺寸不够**。
  //
  // 2026-09-05 深夜真机撞到：小红书千帆的发图确认框关掉之后，那个节点卡在
  // 消失动画里没被移除 —— `opacity: 0`、还挂着 `portal-fade-leave-active`，
  // 但**矩形照旧存在**。只看 `getClientRects` 的判据把这个幽灵当成了「框还
  // 在」，于是去点它上面的确认键、报「已点」，而屏幕上什么都没有。那种谎
  // 比读不到更糟：它让上层以为图发出去了。
  //
  // 所以往上走一遍祖先链，任何一层 `opacity: 0` / `visibility: hidden` /
  // `display: none` 都算看不见。上限 12 层，够覆盖弹窗那几层包装，也不会
  // 在深树上白跑。
  function trulyVisible(el) {
    if (!el || !el.getClientRects || el.getClientRects().length === 0) { return false; }
    var n = el;
    for (var i = 0; i < 12 && n && n !== document.body; i++) {
      var cs = null;
      try { cs = getComputedStyle(n); } catch (e) { return true; }
      if (!cs) { return true; }
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') { return false; }
      n = n.parentElement;
    }
    return true;
  }

  // 弹窗里有没有提到这些字样。
  //
  // 只在弹窗容器里找，不扫整个 body.innerText：后者会强制整页重排，而这个
  // 探测每 3 秒跑一次。
  function dialogMentions(roots, needles) {
    if (typeof roots !== 'string' || roots === '') { return false; }
    if (!Array.isArray(needles) || needles.length === 0) { return false; }
    var nodes;
    try {
      nodes = document.querySelectorAll(roots);
    } catch (e) {
      throw new Error('选择器 ' + roots + ' 不合法：' + String(e && e.message));
    }
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      // 隐藏的弹窗节点在 Ant Design 里会留在 DOM 里。把它们算上会让一个
      // 关掉的验证框永远把我们挡在门外。**幽灵节点同理**：关掉之后卡在
      // 消失动画里的框还有矩形，只看矩形会让闸门永远判「验证框还开着」。
      if (!trulyVisible(el)) { continue; }
      var text = el.innerText || '';
      for (var j = 0; j < needles.length; j++) {
        var n = needles[j];
        if (typeof n === 'string' && n !== '' && text.indexOf(n) !== -1) { return true; }
      }
    }
    return false;
  }

  // 每条选择器在页面上命中几个。**用来点名是哪一条失效了。**
  //
  // 一句「页面结构变了」对修复毫无帮助；「input 这条命中 0 个」直接告诉用户
  // 该去改配置里的哪一行。千牛的锚点失效错误就是这么写的。
  ops.matchCounts = function (args) {
    var sel = (args && args.selectors) || {};
    var out = {};
    for (var name in sel) {
      if (!Object.prototype.hasOwnProperty.call(sel, name)) { continue; }
      var q = sel[name];
      if (typeof q !== 'string' || q === '') { out[name] = -1; continue; }
      try {
        out[name] = document.querySelectorAll(q).length;
      } catch (e) {
        // 语法错误与「没匹配到」是两回事：前者改错了字，后者是页面变了。
        out[name] = -1;
      }
    }
    return out;
  };

  // ---- 读会话 --------------------------------------------------------------
  //
  // 页面侧只**采集**，一个判断都不做：方向对不对、买家是谁、有没有重复，
  // 全部由 Rust 判定。理由同写入通道 —— 让可能失效的那一方给自己打分是没有
  // 意义的，而且判断放在 Rust 才能离线测。

  // 一条消息的身份。**闲鱼既不给消息 id，也不给每条消息的时间**
  // （v6/v7 探测确认：从气泡一路走到列表根，除了虚拟列表自己的 data-appeared /
  // data-before-current-y 之外没有任何属性；title 属性一个都没有）。
  //
  // 但它给了**分组时间标签**：消息流里夹着一些叶子节点，整段文本恰好就是
  // 「HH:MM」。于是身份取「所属时间组 + 组内第几条」。
  //
  // 组内序号为什么稳定：消息只会往后追加，一个时间组一旦过去内容就不再变。
  // 老消息即使被滚出 DOM 也不影响 —— 我们只关心「上次回复之后」那一批，
  // 它们永远在最底下。
  function isTimeLabel(el) {
    if (el.children.length !== 0) { return false; }
    var t = (el.textContent || '').trim();
    // 闲鱼真机既有「14:57」，也有「昨天 21:47」「11-05 21:31」这类带日期
    // 的分组标签。只认 HH:MM 会把跨天会话的所有消息压成同一组，宿主侧
    // 再用「当前时间」补齐，AI 就会把旧消息当成刚发生的上下文。
    return /^(?:(?:今天|昨天|前天)\s*)?(?:\d{1,2}:\d{2}(?::\d{2})?|\d{4}-\d{1,2}-\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?|\d{1,2}-\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)$/.test(t) ||
      /^(?:刚刚|\d+\s*(?:秒|分钟|小时|天)前)$/.test(t);
  }

  // 递归找「看起来像那个东西」的字段，**不写死 JSON 路径**。
  //
  // 这条是从老工程读来的思路：MTop 响应的嵌套层级会变，写死路径等于把一次
  // 无声的失效埋进代码。判据是「这个对象有没有那几个键」，不是「它在第几层」。
  function findAll(node, pred, out, depth) {
    if (out.length >= 200 || depth > 8 || node === null || typeof node !== 'object') { return out; }
    if (!Array.isArray(node) && pred(node)) { out.push(node); }
    var keys = Array.isArray(node) ? node : Object.keys(node).map(function (k) { return node[k]; });
    for (var i = 0; i < keys.length && out.length < 200; i++) {
      findAll(keys[i], pred, out, depth + 1);
    }
    return out;
  }

  function parseKept(api) {
    if (!Object.prototype.hasOwnProperty.call(kept, api)) { return null; }
    try { return JSON.parse(kept[api].body); } catch (e) { return null; }
  }

  // 会话列表里所有买家的昵称，以及**我方**的昵称。
  //
  // 我方昵称是交叉校验用的：方向判定靠类名 left/right，而类名是 CSS Modules
  // 哈希 —— 哪天闲鱼把 left/right 换成别的命名，方向会**静默反转**，AI 就会
  // 对着自己刚说过的话生成回复。
  // 一个「人」身上可能挂着好几个名字：`nick`、`fishNick`、`displayName`。
  // **会话列表显示的是哪一个，我们不知道** —— 2026-08-27 真机联测就栽在这上面：
  // 只收 `nick` 时，DOM 读到的昵称与名单对不上，交叉校验把一次完全正确的读取
  // 判成了失效。
  //
  // 教训不是「当时该挑对那个字段」，是**别去挑**：把这个人所有像名字的字段
  // 全收下，交叉校验只问「对得上其中之一吗」。收多了最坏是漏掉一次真的失效，
  // 收少了则是把正常工作的系统卡死 —— 后者严重得多。
  var NAME_KEYS = ['nick', 'fishNick', 'displayName', 'userNick'];

  function namesOf(person) {
    var out = [];
    if (!person || typeof person !== 'object') { return out; }
    for (var i = 0; i < NAME_KEYS.length; i++) {
      var v = person[NAME_KEYS[i]];
      if (typeof v === 'string' && v !== '' && out.indexOf(v) === -1) { out.push(v); }
    }
    return out;
  }

  function identities() {
    var sync = parseKept('mtop.taobao.idlemessage.pc.session.sync');
    if (!sync) { return { nicks: [], self: null }; }
    var nicks = [];
    findAll(sync, function (o) {
      return o.userInfo && typeof o.userInfo === 'object';
    }, [], 0).forEach(function (o) {
      namesOf(o.userInfo).forEach(function (n) {
        if (nicks.indexOf(n) === -1) { nicks.push(n); }
      });
    });
    var owners = findAll(sync, function (o) {
      return o.ownerInfo && typeof o.ownerInfo === 'object';
    }, [], 0);
    var selfNames = owners.length ? namesOf(owners[0].ownerInfo) : [];
    // 我方的名字也全部进名单：一人多名时，会话列表里显示的可能是任何一个。
    selfNames.forEach(function (n) {
      if (nicks.indexOf(n) === -1) { nicks.push(n); }
    });
    return { nicks: nicks, self: selfNames.length ? selfNames[0] : null, selfNames: selfNames };
  }

  // 这个会话在聊哪个商品。千牛至今没做到的一件事，闲鱼直接有。
  // 当前会话在聊的商品：标题 + **id**。
  //
  // id 才是身份，标题会漂（商家改一次标题，按标题键的知识就整批失效，
  // 而失效是静默的）。两者在同一份 `headinfo` 里，是顺手多取一个字段。
  //
  // 2026-08-26 探针记录：`headinfo` 带 `commonData.itemId`、`price`、
  // `subTitle`、`tagList`。
  function product() {
    var head = parseKept('mtop.idle.trade.pc.message.headinfo');
    if (!head) { return { title: null, id: null }; }
    // `subTitle` 在这份响应里不止一处：商品那块有，价格那块也有（真机
    // 2026-08-28：`含运费0.00元` 被当成了商品标题，一直留在会话上）。
    // 先挑带 itemId 的那个对象里的；没有再在剩下的里去掉像价格/运费的那些，
    // 取最长的一条 —— 标题总比价格行长。
    var hit = findAll(head, function (o) {
      return typeof o.subTitle === 'string' && o.subTitle !== '';
    }, [], 0);
    var looksPrice = function (s) {
      return /^(含运费|运费|包邮|¥|￥|\d+(\.\d+)?元)/.test(s) || /^[¥￥]?\s*\d+(\.\d+)?\s*(元|万)?$/.test(s) || s.length <= 3;
    };
    var title = null;
    for (var hi = 0; hi < hit.length; hi++) {
      if (hit[hi].itemId !== undefined && hit[hi].itemId !== null && !looksPrice(hit[hi].subTitle)) { title = hit[hi].subTitle; break; }
    }
    if (title === null) {
      for (var hj = 0; hj < hit.length; hj++) {
        var st = hit[hj].subTitle;
        if (looksPrice(st)) { continue; }
        if (title === null || st.length > title.length) { title = st; }
      }
    }
    // id 单独找：带 subTitle 的那个对象不一定同时带 itemId（探针里
    // itemId 挂在 commonData 上）。**分开找而不是假设同一层。**
    var withId = findAll(head, function (o) {
      return o.itemId !== undefined && o.itemId !== null && String(o.itemId) !== '';
    }, [], 0);
    var id = withId.length ? String(withId[0].itemId) : null;
    return { title: title, id: id };
  }

  // 当前选中会话的买家昵称。
  //
  // 昵称**不在任何属性里**（v6 确认），在文本里；v7 确认它是会话项里
  // **第一个有文字的叶子节点**。这是形状判据而不是位置路径 —— 位置路径
  // （`div > div > div > div`）改版一次就废。
  //
  // 万一这条判据将来失效，后果是读到一个错的昵称，而白名单闸门会因此**拒发**
  // （空名单 = 谁都不回，名单不匹配 = 不回）。也就是说它失效的方向是安全的：
  // 不会发给错的人，只会不发。
  // 买家唯一 id：容器里某张 `<img>` 的 src 命中画像的正则（第一个捕获组）。
  // 找不到返回 null —— 那时会话键退回昵称，与不配这条时一样。
  function buyerIdOf(scope, pattern, attr) {
    if (!scope) { return null; }
    // v31（2026-09-05）：属性值**整个就是 id** 的情形 —— 配了 `buyerIdAttr`
    // 而没配 `buyerIdPattern`。小红书千帆的会话项自带
    // `data-key="$3$MSMy…"`，那本身就是会话唯一 id，没有什么要从里面抠的；
    // 硬凑一个 `^(.+)$` 只是迁就「必须有正则」这条，而那条本来只为从头像
    // 地址里抠 id 而存在。
    //
    // **先看自己再看后代**：`data-key` 就在会话项那一层上，而
    // `querySelectorAll` 不含自己。
    if (attr && !pattern) {
      var own = scope.getAttribute ? scope.getAttribute(attr) : null;
      if (own) { return String(own); }
      var inner;
      try { inner = scope.querySelector('[' + attr + ']'); } catch (e0) { return null; }
      var iv = inner ? inner.getAttribute(attr) : '';
      return iv ? String(iv) : null;
    }
    if (!pattern) { return null; }
    var re;
    try { re = new RegExp(pattern); } catch (e) { return null; }
    // 配了属性名（拼多多 `data-random`）就在属性值上套正则；否则套头像地址。
    if (attr) {
      var holders;
      try { holders = scope.querySelectorAll('[' + attr + ']'); } catch (e1) { return null; }
      // 自己身上带的也算（理由同上）。
      if (scope.getAttribute && scope.getAttribute(attr) !== null) {
        var mSelf = re.exec(scope.getAttribute(attr) || '');
        if (mSelf && mSelf[1]) { return mSelf[1]; }
      }
      for (var h = 0; h < holders.length; h++) {
        var m0 = re.exec(holders[h].getAttribute(attr) || '');
        if (m0 && m0[1]) { return m0[1]; }
      }
      return null;
    }
    var imgs = scope.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      var src = imgs[i].currentSrc || imgs[i].src || '';
      var m = re.exec(src);
      if (m && m[1]) { return m[1]; }
    }
    return null;
  }

  // 会话键 = 昵称，配了 `buyerIdPattern` 就是「昵称#id」。**发现、切换、
  // 读会话三处都用它**，各认各的话就点不中。
  function keyOf(item, nickSel, idPattern, idAttr) {
    var nick = nickOf(item, nickSel);
    if (nick === null) { return null; }
    var id = buyerIdOf(item, idPattern, idAttr);
    return id ? nick + '#' + id : nick;
  }

  // 当前会话买家的 id：先在会话列表里找昵称恰好等于它的那一项（唯一才认），
  // 找不到就从会话区里买家气泡旁的头像上抠。
  function activeBuyerId(nick, a) {
    // 只配了 `buyerIdAttr`（属性值整个就是 id）也算 —— 见 `buyerIdOf`。
    if (!a.buyerIdPattern && !a.buyerIdAttr) { return null; }
    var items;
    try { items = document.querySelectorAll(a.conversationItem); } catch (e) { items = []; }
    var hits = [];
    for (var i = 0; i < items.length; i++) {
      if (nickOf(items[i], a.conversationNick) === nick) { hits.push(items[i]); }
    }
    if (hits.length === 1) {
      var fromItem = buyerIdOf(hits[0], a.buyerIdPattern, a.buyerIdAttr);
      if (fromItem) { return fromItem; }
    }
    var root = null;
    try { root = document.querySelector(a.chatArea); } catch (e2) { root = null; }
    if (!root || !a.messageLeft) { return null; }
    var bubbles;
    try { bubbles = root.querySelectorAll(a.messageLeft); } catch (e3) { return null; }
    for (var b = bubbles.length - 1; b >= 0; b--) {
      var box = (a.messageContent && bubbles[b].closest(a.messageContent)) || bubbles[b];
      var id = buyerIdOf(box, a.buyerIdPattern, a.buyerIdAttr);
      if (id) { return id; }
    }
    return null;
  }

  function activeBuyer(sel, ph, nickSel, a) {
    // v53：**聊天区里写着是谁，就是谁**；列表选中项只拿来核对。
    //
    // - 聊天区里没有那个昵称 → 没点开会话（0）
    // - 列表选中项恰好一个、昵称一样 → 就是他（1）
    // - 两边对不上（列表正在重排、正在切换）→ 说不准（-2）。**不是 0**：
    //   把「这一两秒说不准」报成「没点开」，下游会以为商家关掉了会话。
    //
    // 为什么还要核对：切换的那一刻顶栏可能还是上一个人、消息区已经换成下一个
    // 人的了。只信顶栏会把下一个人的话记到上一个人头上；两边一致才算数。
    if (a && a.paneNick) {
      var head = null;
      try { head = document.querySelector(a.paneNick); } catch (eh) { return { count: -1, nick: null }; }
      var hn = head ? String(head.getAttribute('title') || head.textContent || '').trim() : '';
      if (hn === '') { return { count: 0, nick: null }; }
      var act;
      try { act = document.querySelectorAll(sel); } catch (ea) { return { count: -1, nick: null }; }
      // 列表里一个选中项都没有 = 选中的那一项此刻不在 DOM 里（列表被滚走、
      // 虚拟列表没渲染、正在筛选）。那**不是**「正在切换」—— 真机录像里切换时
      // 列表是 2 项，不是 0 项。这时信聊天区；两项及以上、或昵称对不上才是说不准。
      if (act.length > 1) { return { count: -2, nick: null }; }
      var ln = act.length === 1 ? nickOf(act[0], nickSel) : hn;
      if (ln !== hn) { return { count: -2, nick: null }; }
      var pid = null;
      // v54：会话 id 读**消息身上**的（小红书 `data-chat-id`）。它说的是
      // 「这些消息属于哪个会话」—— 切换那一刻消息区换了、列表还没换，这里
      // 就对不上，报 -2，而不是把下一个人的话记到上一个人头上。
      if (a.paneIdAttr) {
        var seen = {}, distinct = [];
        var area = null;
        try { area = document.querySelector(a.chatArea); } catch (ec) { area = null; }
        var holders = [];
        try { holders = (area || document).querySelectorAll('[' + a.paneIdAttr + ']'); } catch (ep) { holders = []; }
        for (var h = 0; h < holders.length; h++) {
          var v = holders[h].getAttribute(a.paneIdAttr) || '';
          if (v && !seen[v]) { seen[v] = true; distinct.push(v); }
        }
        if (distinct.length > 1) { return { count: -2, nick: null }; }
        if (distinct.length === 1) {
          pid = distinct[0];
          var lid = act.length === 1 ? buyerIdOf(act[0], a.buyerIdPattern, a.buyerIdAttr) : null;
          if (lid && lid !== pid) { return { count: -2, nick: null }; }
        }
      }
      // 没有消息（新会话）时，会话 id 先从**唯一的选中项**取 —— 与改动前一样。
      // `activeBuyerId` 按昵称在列表里找，两个同名买家时会找不到、退成只有
      // 昵称的键（2026-09-23 复核指出）。
      if (!pid && act.length === 1) { pid = buyerIdOf(act[0], a.buyerIdPattern, a.buyerIdAttr); }
      if (!pid) { pid = activeBuyerId(hn, a); }
      return { count: 1, nick: pid ? hn + '#' + pid : hn };
    }
    // 有 placeholder 规则就走它：抖店的会话项选中态只有构建哈希类名，而
    // 输入框上写着「发送给 S.，使用Enter 发送消息…」—— 页面唯一一处语义化
    // 地写着「当前在跟谁说话」的地方。输入框不在或前缀没命中 = 没选中会话。
    if (ph && ph.prefix) {
      var box = null;
      try { box = document.querySelector(ph.input); } catch (e) { return { count: -1, nick: null }; }
      if (!box) { return { count: 0, nick: null }; }
      var text = String(box.getAttribute('placeholder') || '');
      if (text.indexOf(ph.prefix) !== 0) { return { count: 0, nick: null }; }
      var rest = text.slice(ph.prefix.length);
      var cut = rest.search(/[，,]/);
      var nick = (cut === -1 ? rest : rest.slice(0, cut)).trim();
      if (nick === '') { return { count: 0, nick: null }; }
      var id = a ? activeBuyerId(nick, a) : null;
      return { count: 1, nick: id ? nick + '#' + id : nick };
    }
    var items;
    try { items = document.querySelectorAll(sel); } catch (e) { return { count: -1, nick: null }; }
    if (items.length !== 1) { return { count: items.length, nick: null }; }
    return { count: 1, nick: keyOf(items[0], nickSel, a ? a.buyerIdPattern : '', a ? a.buyerIdAttr : '') };
  }

  // 当前会话是谁。切换之后 Rust 侧拿它等「真的换过去了」，不再固定睡 1.5 秒。
  //
  // 顺带报**消息区里有几条消息**（`messages`）。左侧列表的高亮一点就换，
  // 右侧消息区却是异步拉的 —— 没打开过的会话要几百毫秒到一两秒。只看
  // 高亮就算切好，紧接着读会话读到的是空的（2026-09-05 闲鱼真机：切换后
  // 3 毫秒读空，被当成「平台不显示消息」而刷新了页面）。消息区不在或
  // 选择器不合法报 -1，Rust 侧按「没渲染完」处理。
  ops.activeBuyer = function (args) {
    var a = args || {};
    var who = activeBuyer(a.conversationActive, { input: a.input, prefix: a.activePlaceholderPrefix }, a.conversationNick, a);
    var messages = -1;
    try {
      var root = a.chatArea ? document.querySelector(a.chatArea) : null;
      if (root && a.messageContent) { messages = root.querySelectorAll(a.messageContent).length; }
    } catch (e) { messages = -1; }
    return { count: who.count, nick: who.nick, messages: messages };
  };

  // 这一项现在是不是选中的那一项。选择器为空一律 false（不是「不知道」——
  // 调用方拿到 false 会走保守那条路）。
  function isActiveItem(item, sel) {
    if (!sel || !item) { return false; }
    try {
      if (item.matches && item.matches(sel)) { return true; }
      if (item.querySelector && item.querySelector(sel)) { return true; }
    } catch (e) { return false; }
    return false;
  }

  // `activateChat` 在同名项上做过记号之后，问那一项拿到选中态没有。
  // `found: false` = 记号没了（React 重建了节点），那边按「不知道」等固定时长。
  ops.pickedActive = function (args) {
    var a = args || {};
    var el = document.querySelector('[data-shanhui-picked]');
    if (!el) { return { found: false, active: false }; }
    var activeSel = a.activePlaceholderPrefix ? '' : a.conversationActive;
    return { found: true, active: isActiveItem(el, activeSel) };
  };

  // 「买家正在看的商品」的标题，从会话区的卡片上读。
  //
  // 配了 `productCard` + `productCardNeedle` 就**只认带那几个字的卡**：飞鸽
  // 的系统提醒卡（「用户仍在等待您的处理结果…」）与商品卡用同一套类名，
  // 不按字认会把那句提醒当成商品标题（2026-09-03 真机）。卡里第一个占位
  // 是那几个字本身，第二个才是标题，所以取第一个**不等于**针的文字。
  // 取最后一张卡：买家看完一件又看一件，最后那件才是他此刻问的。
  // 标题超过 100 字的不要 —— 那不是标题，是又一张认错的卡。
  function productTitleFromDom(root, a) {
    var scope = [root];
    if (a.productCard) {
      var cards;
      try { cards = root.querySelectorAll(a.productCard); } catch (e) { return null; }
      var needle = squeeze(a.productCardNeedle || '');
      scope = [];
      for (var c = 0; c < cards.length; c++) {
        if (!needle || squeeze(cards[c].innerText || '').indexOf(needle) !== -1) { scope.push(cards[c]); }
      }
      if (!scope.length) { return null; }
      scope = [scope[scope.length - 1]];
    }
    var els;
    try { els = scope[0].querySelectorAll(a.productTitle); } catch (e2) { return null; }
    var needle2 = squeeze(a.productCardNeedle || '');
    var picked = null;
    for (var i = 0; i < els.length; i++) {
      var t = (els[i].innerText || els[i].textContent || '').trim();
      // **含针就跳过，不只全等**：真机见过「用户正在查看商品，来自电商小助手
      // 的推荐」这种带后缀的占位，全等判不掉，就被当成了商品标题。
      if (t === '' || (needle2 && squeeze(t).indexOf(needle2) !== -1)) { continue; }
      if (a.productCard) { picked = t; break; }
      picked = t; // 没配卡容器时沿用旧行为：取最后一个
    }
    if (picked && picked.length > 100) { return null; }
    return picked;
  }

  // ---- 商品 id：三条各不相同的路 -----------------------------------------
  //
  // 2026-09-18 真机逐家探过（`.internal/probe-2026-09-18-chat-product-id.md`）。
  // 三家 DOM 平台此前**一家都拿不到 id**，只有标题 —— 而 `kb_products` 的身份
  // 是平台编号，标题只是别名之一。同店同名不同规格的几件商品（淘宝上「复制
  // 商品」出来的那种是常态）靠标题分不开，`find_by_title` 见到重名直接放弃，
  // 于是整轮的商品上下文丢掉，AI 退回泛泛而谈 —— 而且不报错。

  // 小红书：id 就在 DOM 属性上。
  //
  // 「客户咨询过」面板（`.consulted-goods-container`）默认是收起的
  // （`.expanded-container` 带 `display: none`），**但列表的 DOM 已经渲染好了**，
  // 每件商品一个 `<div data-index="6aa5ddbc68ec340001b64872">`，那 24 位十六进制
  // 就是商品 id。所以不需要点开面板 —— 点开是会改变商家看到的界面的动作。
  //
  // 刷新页面之后重验过（2026-09-18）：全新加载、面板仍带着 `display: none`，
  // `[data-index]` 照样在。取不到时调用方不会出错，只是退回「只有标题」那一档。
  function productIdFromDom(root, a) {
    if (!a.productIdSelector || !a.productIdAttr) { return null; }
    var scope = root;
    if (a.productCard) {
      var cards;
      try { cards = root.querySelectorAll(a.productCard); } catch (e) { return null; }
      var needle = squeeze(a.productCardNeedle || '');
      var picked = null;
      for (var c = 0; c < cards.length; c++) {
        if (!needle || squeeze(cards[c].innerText || '').indexOf(needle) !== -1) { picked = cards[c]; }
      }
      if (!picked) { return null; }
      scope = picked;
    }
    var els;
    try { els = scope.querySelectorAll(a.productIdSelector); } catch (e2) { return null; }
    // **取最后一个**：买家看完一件又看一件，最后那件才是他此刻在问的
    // （与 `productTitleFromDom` 同一条规矩）。
    for (var i = els.length - 1; i >= 0; i--) {
      var v = els[i].getAttribute(a.productIdAttr);
      if (v && String(v).trim() !== '') { return String(v).trim(); }
    }
    return null;
  }

  // 快手：id 挂在**每一条消息**上，不在卡片里。
  //
  // 卡片（`.kwaishop-cs-bizBuyerFromCard`）的 DOM 是纯展示，一个 id 都没有；
  // 图地址里那段 `ITEM_IMAGE-<店铺id>-<32位hex>` 是图片指纹，不是商品 id。
  //
  // 但卡片是 React 渲染的，沿 fiber 往上能拿到页面自己的消息数组，**每条买家
  // 消息**都挂着 `eExtra.bizExtras.MERCHANT.passThroughExtra.commodityId`。
  //
  // # 为什么这比卡片好
  //
  // 卡片是聊天流里的一条消息，买家多聊几句就滚出视野；逐条消息的归属不会。
  // 买家中途切到另一件商品再发言，那条消息自己就带着新的 id ——「买家换商品了」
  // 这件事平台逐条告诉我们，不需要我们去猜。所以这里取的是**最后一条买家消息**
  // 上的那个 id。
  //
  // `commodityId` 是 protobuf 的 long（`{low, high, unsigned}`），要按
  // `high * 2^32 + low` 拼回字符串。直接 `String()` 会得到 `[object Object]`。
  function longToString(v) {
    if (v === null || v === undefined) { return null; }
    if (typeof v === 'object') {
      if (v.low === undefined || v.high === undefined) { return null; }
      try {
        var hi = v.high >>> 0, lo = v.low >>> 0;
        var s = (BigInt(hi) * BigInt(4294967296) + BigInt(lo)).toString();
        return s === '0' ? null : s;
      } catch (e) { return null; }
    }
    var t = String(v).trim();
    return (t === '' || t === '0') ? null : t;
  }

  function productIdFromMessages(root, a) {
    if (!a.productIdFromMessages) { return null; }
    var anchor = null;
    if (a.productCard) {
      try { anchor = root.querySelector(a.productCard); } catch (e) { anchor = null; }
    }
    if (!anchor) { anchor = root; }
    var fk = null;
    var keys = Object.keys(anchor);
    for (var k = 0; k < keys.length; k++) {
      if (keys[k].indexOf('__reactFiber$') === 0 || keys[k].indexOf('__reactInternalInstance$') === 0) {
        fk = keys[k];
        break;
      }
    }
    if (!fk) { return null; }
    var f = anchor[fk];
    var msgs = null;
    // 真机那次在第 17 层。给到 40 层留余量 —— 改版加一层包装就会挪位，
    // 而按层数写死是那种「今天对、下个月静默失效」的判据。
    for (var d = 0; f && d < 40; d++, f = f.return) {
      var p = f.memoizedProps;
      if (p && Object.prototype.toString.call(p.messages) === '[object Array]' && p.messages.length) {
        msgs = p.messages;
        break;
      }
    }
    if (!msgs) { return null; }
    for (var i = msgs.length - 1; i >= 0; i--) {
      var m = msgs[i];
      var id = null;
      try {
        var mer = m && m.eExtra && m.eExtra.bizExtras && m.eExtra.bizExtras.MERCHANT;
        id = mer && mer.passThroughExtra ? longToString(mer.passThroughExtra.commodityId) : null;
      } catch (e2) { id = null; }
      if (id) { return id; }
    }
    return null;
  }

  // 抖店：id 只在接口里。
  //
  // `get_consulting_products` 回的是**这个买家咨询过的全部商品**（可以多件），
  // 每件带 `product_id` 和 `product_name`。取最后一件 —— 与前两条同一条规矩。
  //
  // 标题也一并取回来：卡片那条路读到的标题是 DOM 文字，接口这条更干净，
  // 而且两者对不上时以接口为准（DOM 上那张卡可能已经滚出视野，是上一件的）。
  // 商品卡里的标题。有选择器就用它，没有就走结构判据：**卡里第一个够长的
  // 叶子文字节点就是标题**。
  //
  // 与 `sendProductPick` 认行时同一条判据、同一个理由：这几家的卡片类名
  // 全是每次构建都变的哈希（抖店 `_2a3389bc1da255c500cb6d07f312c984-less`），
  // 配不住。而这些卡都是标题打头，后面才是价、标签、按钮。
  function cardTitle(card, sel) {
    if (sel) {
      var el = null;
      try { el = card.querySelector(sel); } catch (e) { el = null; }
      if (el) { return squeeze(el.innerText || el.textContent || ''); }
    }
    var leaves = card.querySelectorAll('*');
    for (var i = 0; i < leaves.length; i++) {
      if (leaves[i].children.length !== 0) { continue; }
      var t = squeeze(leaves[i].innerText || leaves[i].textContent || '');
      if (t.length >= 6) { return t; }
    }
    return '';
  }

  // v59：以**价格**为锚取卡里的商品名（画像 `message_product_card_price`，抖店
  // `.chatd-price`）。
  //
  // 抖店的卡片抬头是一行字（「来自电商小助手的推荐」，或者「地址修改成功」「这款
  // 商品正在活动中」这类系统卡），商品名在下面那一块里、紧挨着价格。卡片类名是
  // 每次构建都变的哈希，商品名也没有专属类名，「第一个够长的字」取到的永远是抬头
  // （2026-11-11 商家日志：当前商品被认成「地址修改成功」）。
  //
  // 做法：从价格往外一层层找，第一层里出现在价格**前面**的文字，取离价格最近的
  // 那一段。抬头在更外面，到不了。返回 `null` = 卡里没有价格，不是商品卡。
  function titleNearPrice(card, priceSel) {
    var price = null;
    try { price = card.querySelector(priceSel); } catch (e) { return null; }
    if (!price) { return null; }
    for (var anc = price.parentElement; anc && card.contains(anc); anc = anc.parentElement) {
      var best = '';
      var leaves = anc.querySelectorAll('*');
      for (var i = 0; i < leaves.length; i++) {
        var lf = leaves[i];
        if (lf.children.length !== 0 || price.contains(lf)) { continue; }
        // 只要价格前面的。
        if (!(lf.compareDocumentPosition(price) & 4)) { continue; }
        var t = squeeze(lf.innerText || lf.textContent || '');
        if (t.length >= 2) { best = t; }
      }
      if (best) { return best; }
    }
    return '';
  }

  // 商品卡里的商品 id。**只认链接上明写着 id 的那个查询参数。**
  //
  // 闲鱼的卡里 `<a href>` 带 `id=<商品id>`（2026-09-18 真机，发卡片那条
  // 核对就是靠它）。抖店的卡里一个 id 都没有（同日真机），那时返回空串，
  // 由调用方退回按标题认。
  //
  // **不去「在 href 里找一串长数字」** —— 那会把埋点 id、用户 id、店铺 id
  // 一并捞进来，而认错一件商品比认不出糟得多：买家问 A，我们拿 B 的价格
  // 和库存答他，全程不报错。
  // 一次最多报几条被丢掉的消息。**只是诊断，不该把日志淹掉** —— 一个
  // 改了版的平台可能每条消息都落进来，那时前几条已经足够说明形状。
  var MAX_DROPPED = 5;
  function clsOf(el) {
    var c = el && el.className;
    return typeof c === 'string' ? squeeze(c).slice(0, 80) : '';
  }
  function sq90(el) {
    return squeeze((el && (el.innerText || el.textContent)) || '').slice(0, 90);
  }

  var CARD_ID_RE = /[?&](?:id|itemId|item_id|productId|product_id)=([0-9]{6,})/;
  function cardProductId(card) {
    var links;
    try { links = card.querySelectorAll('a[href]'); } catch (e) { return ''; }
    for (var i = 0; i < links.length; i++) {
      var m = String(links[i].getAttribute('href') || '').match(CARD_ID_RE);
      if (m) { return m[1]; }
    }
    return '';
  }

  function productFromConsulting() {
    // v59：**切会话之前到的那份不认。** 飞鸽只在右侧「订单 → 咨询宝贝」那块显示着
    // 时调这个接口（2026-11-11 真机：切到「浏览足迹」再切回来才调）；面板停在别的
    // 页签上时切会话，它不调，留在这里的就是上一位买家的 —— 拿它答这位买家，商品
    // 是错的，而且看起来完全正常。宁可这一轮认不出商品，走下面卡片那几条路。
    var keptAt = Object.prototype.hasOwnProperty.call(kept, 'workstation/get_consulting_products')
      ? kept['workstation/get_consulting_products'].at : 0;
    if (keptAt < lastSwitchAt) { return { title: null, id: null }; }
    var body = parseKept('workstation/get_consulting_products');
    if (!body) { return { title: null, id: null }; }
    var list = null;
    try { list = body.data && body.data.consulting_product; } catch (e) { return { title: null, id: null }; }
    if (Object.prototype.toString.call(list) !== '[object Array]' || !list.length) {
      return { title: null, id: null };
    }
    var last = list[list.length - 1];
    var id = last && last.product_id ? String(last.product_id).trim() : '';
    var title = last && last.product_name ? String(last.product_name).trim() : '';
    return {
      title: title === '' ? null : title,
      id: (id === '' || id === '0') ? null : id
    };
  }

  var MAX_MESSAGES = 200;

  // 这条消息是买家发的还是我们发的。
  //
  // 先按类名（`messageLeft` / `messageRight`），认不出再看**位置**：
  // 气泡在会话区中线的哪一边。位置是这件事最本质的信号 —— 所有聊天界面都
  // 是「对方在左、自己在右」，而类名会随改版变。
  //
  // 图片消息尤其需要这条退路：闲鱼的左右类名是 `message-text-left--`，
  // 里面带着 `text`，图片气泡根本不会命中它。
  //
  // 两条都认不出返回 null，由 Rust 侧报错并跳过这一轮 —— **不猜方向**：
  // 猜错会让 AI 对着自己说过的话生成回复。
  function sideOf(el, a, root) {
    try {
      if (a.messageLeft && (el.matches(a.messageLeft) || el.querySelector(a.messageLeft))) {
        return 'left';
      }
      if (a.messageRight && (el.matches(a.messageRight) || el.querySelector(a.messageRight))) {
        return 'right';
      }
      // v34：**往上找那个消息容器。**
      //
      // 图片那一支传进来的是 `<img>` 本身（见 readChat 里的注释：方向要按
      // 那张图的位置判，不按横贯整行的容器）。可 `<img>` 自己既不匹配
      // 左/右选择器，也没有子节点可 querySelector，于是一路落到下面的几何
      // 判定 —— 而**图片还没加载完时宽度是 0**，几何那一支直接返回 null，
      // 上层就报「这条消息判不出方向」，整轮失败。
      //
      // 2026-09-06 真机撞到一次（小红书）。它是个竞态：图片一加载完下一轮
      // 就好了，所以只偶发一次 —— 而偶发的静默失败最难查。
      //
      // 用声明的选择器往上找，比几何可靠：`closest` 命中的就是画像里写明
      // 的那个左/右容器，不受渲染时机影响。
      if (a.messageLeft && el.closest && el.closest(a.messageLeft)) {
        return 'left';
      }
      if (a.messageRight && el.closest && el.closest(a.messageRight)) {
        return 'right';
      }
    } catch (e) { /* 选择器不合法时退到位置判定 */ }
    try {
      var r = el.getBoundingClientRect();
      var c = root.getBoundingClientRect();
      if (r.width < 1 || c.width < 1) { return null; }
      var mid = c.left + c.width / 2;
      // 用气泡**中心**比中线。用左边缘会把一条很宽的我方消息判成 left。
      return (r.left + r.width / 2) < mid ? 'left' : 'right';
    } catch (e) { return null; }
  }

  // ---- 拼多多：读页面自己的会话数据（v58，2026-11-09）---------------------
  //
  // 拼多多客服页（`mms.pinduoduo.com/chat-merchant`）是 Vue 2，所有会话都在它
  // 的 Vuex 仓库里：`currentUserInfo` 是当前打开的会话，`chatList` 是今天的会话
  // 列表，每条消息带服务端原样的类型编号（`type` / `sub_type` / `from.role` /
  // `is_aut`）。比认类名可靠得多：表情在这里是「[微笑]」，在 DOM 里只是一张
  // 空图；商品卡的 id 在这里是一个字段，在 DOM 里是「商品ID：…复制」一行字；
  // 拼多多自己的机器人回复带 `is_aut: 1`，DOM 里看不出来。
  //
  // **只读。** 不调它的 action、不改 state、不碰它的 WebSocket（文件头纪律）。
  // 读不到（改版、仓库名换了）就返回 null，调用方退回 DOM 那条路 —— 那条路
  // 的画像字段照样配全了。
  //
  // 类型怎么归，照 Customer-Agent（github.com/JC0v0/Customer-Agent）抓包整理
  // 的那张表（`message_rules.py`），再加 2026-11-09 真机看到的形状。
  function pddStore() {
    var starts = [document.getElementById('app'), document.querySelector('#replyTextarea'),
      document.querySelector('.left-panel'), document.body && document.body.firstElementChild];
    for (var s = 0; s < starts.length; s++) {
      var el = starts[s];
      for (var d = 0; el && d < 14; d++) {
        var vm = el.__vue__;
        var st = vm && vm.$store && vm.$store.state;
        if (st && typeof st === 'object' && ('currentUserInfo' in st) && ('chatList' in st)) { return st; }
        el = el.parentElement;
      }
    }
    return null;
  }

  // 不进会话记录的类型：已读同步、转接通知、系统推送、拼多多机器人提示
  // （「机器人未找到对应的回复」「机器人已暂停接待」—— **它挂在买家名下**，
  // `from.role` 是 `user`，只看发送方会把它当成买家说的话）、用户来源、FAQ、
  // 素材上传、撤回。
  var PDD_IGNORE = { 20: 1, 24: 1, 30: 1, 31: 1, 41: 1, 56: 1, 97: 1, 1002: 1 };

  function pddClock(sec) {
    var n = Number(sec);
    if (!isFinite(n) || n <= 0) { return ''; }
    if (n > 100000000000) { n = Math.floor(n / 1000); }
    var t = new Date(n * 1000);
    function p2(x) { return (x < 10 ? '0' : '') + x; }
    return p2(t.getHours()) + ':' + p2(t.getMinutes()) + ':' + p2(t.getSeconds());
  }

  function pddStr(v) { return (v === null || v === undefined) ? '' : String(v); }

  // 这条客服侧消息是不是**拼多多自己的机器人 / 自动回复**发的。
  //
  // **不能只看 `is_aut`**（2026-11-09 真机）：机器人的「亲，请问有什么可以帮到您
  // 呢~」`is_aut: 0`、`manual_reply: 1`，跟人发的一模一样。认它靠的是机器人消息
  // 独有的三样：`show_auto: true`、`template_name: "mall_robot_text_msg"`、
  // `biz_context.robot_msg_id`。我们从页面里发的消息这三样都没有。
  //
  // 认出来标成自动消息，管线把它当透明的：不算我们回过，也不算商家亲手回过
  // （`pipeline::observe::snapshot_of`）—— 机器人答过不等于有人答过。
  function pddIsAuto(m) {
    if (!m) { return false; }
    if (m.is_aut === 1 || m.is_aut === true || m.is_aut === '1') { return true; }
    if (m.show_auto === true) { return true; }
    if (/robot/i.test(pddStr(m.template_name))) { return true; }
    return !!(m.biz_context && typeof m.biz_context === 'object' && m.biz_context.robot_msg_id);
  }

  // 一条仓库消息 → 一条 `readChat` 消息。返回 null = 不进记录；返回
  // `{ dropped: … }` = 不认识的类型（上报，不丢得无声无息）。
  function pddMessage(m) {
    if (!m || typeof m !== 'object') { return null; }
    var type = Number(m.type);
    if (PDD_IGNORE[type]) { return null; }
    var role = pddStr(m.from && m.from.role).toLowerCase();
    var side = role === 'user' ? 'left' : role === 'mall_cs' ? 'right' : '';
    if (!side) { return null; }   // system / mall 发的：系统消息，不进对话
    var info = (m.info && typeof m.info === 'object') ? m.info : {};
    var out = {
      body: '', isImage: false, imageSrc: '', side: side,
      // 与 DOM 那条路的消息身份逐字相同（`li.onemsg` 的 id）：两条路在不同
      // 轮次之间切换时，去重键不能变。
      ts: 'middlePanel_list_' + pddStr(m.msg_id),
      time: pddClock(m.ts),
      auto: side === 'right' && pddIsAuto(m)
    };
    var content = typeof m.content === 'string' ? m.content : '';
    if (type === 0) {
      var sub = (m.sub_type === undefined || m.sub_type === null) ? null : Number(m.sub_type);
      if (sub === 0 || sub === 2) {
        // 0 = 买家拍过来的商品咨询卡；2 = 我们发出去的商品卡。
        out.isProduct = true;
        out.productTitle = pddStr(info.goodsName || info.goods_name);
        out.productId = pddStr(info.goodsID || info.goodsId || info.goods_id);
        return out;
      }
      if (sub === 1) {
        // 订单信息。买家紧接着往往问「退货地址」—— 带上能读到的那几样。
        var on = pddStr(info.goodsName || info.goods_name || info.orderSn || info.order_sn);
        out.body = '[订单信息]' + (on ? ' ' + on : '') + (content && !/^https?:/.test(content) ? ' ' + content : '');
        return out;
      }
      out.body = content;
      return out;
    }
    if (type === 1) {
      out.isImage = true;
      out.imageSrc = pddStr(info.image_url || content);
      return out;
    }
    if (type === 5) {
      out.body = pddStr(info.description) || content || '[表情]';
      return out;
    }
    if (type === 8) {
      var gn = pddStr(info.goodsName || info.goods_name);
      var st8 = pddStr(info.statusDesc || info.status_desc || info.afterSalesStatus || info.after_sales_status);
      out.body = '[订单卡片]' + (gn ? ' ' + gn : '') + (st8 ? '（' + st8 + '）' : '');
      return out;
    }
    if (type === 14) {
      out.body = '[视频]';
      return out;
    }
    if (type === 64) {
      // 规格 / 业务卡片，6 种模板，字段不统一（Customer-Agent 注释）。按结构探。
      var dt = (info.data && typeof info.data === 'object') ? info.data : {};
      var gi = (dt.goods_info && typeof dt.goods_info === 'object') ? dt.goods_info : dt;
      var name64 = pddStr(gi.goodsName || gi.goods_name);
      var spec64 = pddStr(gi.goodsSpec || gi.spec || gi.goods_spec);
      out.body = '[商品规格]' + (name64 ? ' ' + name64 : '') + (spec64 ? ' ' + spec64 : '');
      var id64 = pddStr(gi.goodsID || gi.goodsId || gi.goods_id);
      if (name64 || id64) { out.productTitle = name64; out.productId = id64; }
      return out;
    }
    return { dropped: { why: 'pdd-type', cls: 'type=' + type + (m.sub_type !== undefined ? '/' + m.sub_type : ''), text: role } };
  }

  // `readChat` 的仓库版。当前买家仍由 DOM 认（聊天区顶部昵称 + 消息上的
  // `currentuid`，见 `activeBuyer`），这里再核对一次仓库里的当前会话是不是同一个
  // 人 —— 切换的那一刻仓库和页面可能不同步，对不上就报「正在切换」。
  function pddReadChat(a) {
    var st = pddStore();
    if (!st) { return null; }
    var cur = st.currentUserInfo;
    var uid = cur && cur.userInfo && cur.userInfo.uid ? String(cur.userInfo.uid) : '';
    var list = cur && Array.isArray(cur.messageList) ? cur.messageList : null;
    if (!list) { return null; }
    var buyer = activeBuyer(a.conversationActive, { input: a.input, prefix: a.activePlaceholderPrefix }, a.conversationNick, a);
    var count = buyer.count;
    if (count === 1) {
      var key = String(buyer.nick || '');
      var hash = key.lastIndexOf('#');
      var paneId = hash >= 0 ? key.slice(hash + 1) : '';
      if (!uid || (paneId && paneId !== uid)) { count = -2; }
    }
    var messages = [], dropped = [], capped = false;
    var start = list.length > 200 ? list.length - 200 : 0;
    if (start > 0) { capped = true; }
    // 买家当前问的商品：按出现顺序取**最后一个**，商品卡、规格卡、以及
    // 「[当前用户来自 商品详情页]」（type 41，不进对话，但 `info.goods_info` 里写着
    // 他是从哪件商品进来的 —— 买家进来只说「你好」时，这是唯一的商品线索）。
    var prod = { title: '', id: '' };
    for (var i = start; i < list.length; i++) {
      var raw = list[i];
      if (raw && Number(raw.type) === 41 && raw.info && raw.info.goods_info && typeof raw.info.goods_info === 'object') {
        var g41 = raw.info.goods_info;
        var t41 = pddStr(g41.goods_name || g41.goodsName), id41 = pddStr(g41.goods_id || g41.goodsID);
        if (t41 || id41) { prod = { title: t41, id: id41 }; }
        continue;
      }
      var r = pddMessage(raw);
      if (!r) { continue; }
      if (r.dropped) { if (dropped.length < 5) { dropped.push(r.dropped); } continue; }
      messages.push(r);
      if (r.isProduct || r.productId || r.productTitle) { prod = { title: r.productTitle || '', id: r.productId || '' }; }
    }
    // 拼多多自己打的**纠纷 / 投诉提示**，判法照它会话列表那一项（`ChatDetail` 组件）
    // 的写法（2026-11-09 读页面代码；还没在真实店铺见过一次）：
    //   - 会话最后一条消息带 `isArgue` → 列表写「[纠纷预警，请立即跟进]」；
    //   - 买家在 `complainingUserList` 里（`user_id` 对得上），且没过 `complaint_ts`
    //     起一天、投诉之后客服还没人工回过 → 「[买家投诉了您，请尽快回复]」。
    //     「人工回过」拼多多数的是 `manual_reply` 的客服消息；它的机器人也带
    //     `manual_reply`，这里不算机器人（`pddIsAuto`）—— 机器人答过不等于有人管了。
    var alert = '';
    var lastRaw = list.length ? list[list.length - 1] : null;
    if ((cur.lastMessage && cur.lastMessage.isArgue) || (lastRaw && lastRaw.isArgue)) {
      alert = '纠纷预警，请立即跟进';
    } else if (uid && Array.isArray(st.complainingUserList)) {
      for (var ci = 0; ci < st.complainingUserList.length; ci++) {
        var ce = st.complainingUserList[ci] || {};
        if (String(ce.user_id) !== uid) { continue; }
        var cts = Number(ce.complaint_ts);
        if (!(cts > 0) || Date.now() / 1000 > cts + 86400) { break; }
        var handled = false;
        for (var cj = 0; cj < list.length; cj++) {
          var cm = list[cj];
          if (cm && Number(cm.ts) > cts && pddStr(cm.from && cm.from.role).toLowerCase() === 'mall_cs' &&
              cm.manual_reply && !pddIsAuto(cm)) { handled = true; break; }
        }
        if (!handled) { alert = '买家投诉了您，请尽快回复'; }
        break;
      }
    }
    return {
      messages: messages,
      nodeCount: messages.length,
      capped: capped,
      buyerNick: buyer.nick,
      activeCount: count,
      selfNick: null,
      selfNicks: [],
      knownNicks: [],
      product: prod.title,
      productId: prod.id,
      typing: false,
      dropped: dropped,
      alert: alert || null,
      via: 'store'
    };
  }

  // `pendingChats` 的仓库版。待回复 = 这个会话**最后一条算数的消息是买家发的**
  // （跳过上面那些不进记录的类型，也跳过拼多多机器人的自动回复（`pddIsAuto`）——
  // 机器人答过不等于有人答过），或者页面自己在计「未回复」（`unReplyTs` 非空）。
  //
  // 2026-11-09 真机：买家从商品进来、机器人回了两句之后，这个会话落在「已回复」组、
  // `unReplyTs` 是空的 —— 只看页面的「未回复」会把它漏掉，所以这里自己往回数。
  function pddPending(a) {
    var st = pddStore();
    if (!st || !Array.isArray(st.chatList)) { return null; }
    var block = {};
    (a.blocklist || []).forEach(function (n) { block[String(n)] = 1; });
    var pending = [];
    for (var i = 0; i < st.chatList.length; i++) {
      var c = st.chatList[i] || {};
      var u = c.userInfo || {};
      var uid = u.uid ? String(u.uid) : '';
      var nick = pddStr(u.nickname).trim();
      if (!uid || !nick || block[nick]) { continue; }
      // 真机两种形状（2026-11-09）：待回复时是**秒级时间戳数字**（1794278215），
      // 不用回时是**空串**。0 / "0" 也按不用回算 —— 哪天它拿 0 表示「没有」，
      // 把它当成待回复会让我们对着一个答过的买家反复切过去。
      var ur = c.unReplyTs;
      var waiting = (typeof ur === 'number' && ur > 0) ||
        (typeof ur === 'string' && ur.trim() !== '' && ur.trim() !== '0');
      if (!waiting) {
        var ml = Array.isArray(c.messageList) && c.messageList.length ? c.messageList : (c.lastMessage ? [c.lastMessage] : []);
        for (var k = ml.length - 1; k >= 0; k--) {
          var m = ml[k];
          if (!m || PDD_IGNORE[Number(m.type)]) { continue; }
          var role = pddStr(m.from && m.from.role).toLowerCase();
          if (role === 'mall_cs' && pddIsAuto(m)) { continue; }
          waiting = role === 'user';
          break;
        }
      }
      if (waiting) { pending.push(nick + '#' + uid); }
    }
    return { itemCount: st.chatList.length, pending: pending, classHint: null, via: 'store', apiUnread: 0 };
  }

  ops.readChat = function (args) {
    var a = args || {};
    if (a.chatStore === 'pdd') {
      var fromStore = pddReadChat(a);
      if (fromStore) { return fromStore; }
    }
    var root;
    try { root = document.querySelector(a.chatArea); } catch (e) {
      throw new Error('会话区选择器不合法：' + String(e && e.message));
    }
    if (!root) { throw new Error('会话区不在（' + String(a.chatArea) + '）'); }

    var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    var messages = [];
    var nodeCount = 0;
    var curTime = null;
    var inGroup = 0;
    var capped = false;
    // 这一轮看见的商品卡片，**不管方向判没判出来**。商品捕获用它，不用
    // `messages` —— 判不出方向的卡片进不了 `messages`（见那一支的注释），
    // 而商品这件事本来就与方向无关。
    var cardsSeen = [];
    // 被丢掉的消息容器，只上报不改行为。
    var dropped = [];

    // 消息身份：有 `messageIdAttr` 就取那个属性（抖店每条消息内层 div 带
    // `data-id`），没有才用「时间标签 + 组内序号」合成。属性在气泡的祖先
    // 上（文字消息）或容器的后代上（图片消息），两边都找。
    // 每条消息旁的时间文字（画像 `messageTime`）。在这条消息的容器里找 ——
    // 文字气泡的时间在它的兄弟分支上，所以先 `closest` 回容器再往下找。
    function timeOf(el) {
      // v30：**先看属性**（画像 `messageTimeAttr`，毫秒 epoch）。小红书千帆
      // 每条消息的载体上带 `data-timestamp`，而它显示的文字只有 `15:08` ——
      // 分钟级，还在兄弟分支上读不到。属性秒级、不用猜日期、不受平台显示
      // 时区影响。换算成 `HH:MM:SS` 交出去，与另几个平台同一个形状。
      if (a.messageTimeAttr) {
        var holder = el.closest('[' + a.messageTimeAttr + ']');
        if (!holder && a.messageContent) {
          var box0 = el.closest(a.messageContent);
          if (box0) { holder = box0.querySelector('[' + a.messageTimeAttr + ']'); }
        }
        var ms = holder ? Number(holder.getAttribute(a.messageTimeAttr)) : NaN;
        // 只认**看起来像毫秒 epoch** 的数：13 位、2001 年以后。秒级或者
        // 别的编号混进来会算出一个荒唐的时刻，而那会让「等买家说完」和
        // 「切旧消息」两处判断一起走偏 —— 宁可当读不到。
        if (isFinite(ms) && ms > 1000000000000) {
          var d = new Date(ms);
          function two(n) { return (n < 10 ? '0' : '') + n; }
          return two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds());
        }
      }
      if (!a.messageTime) { return ''; }
      var box = (a.messageContent && el.closest(a.messageContent)) || el;
      var t = null;
      try { t = box.querySelector(a.messageTime); } catch (e) { return ''; }
      return t ? (t.textContent || '').trim() : '';
    }
    // 平台自动发的消息（画像 `autoMarkers`）：容器里有一个叶子的文字
    // **全等**于列表里的某一条。全等而不是包含 —— 买家正文里出现这几个字
    // 的概率极低，但整段 innerText 包含它的概率不是零。
    var autoMarks = Array.isArray(a.autoMarkers) ? a.autoMarkers.map(squeeze) : [];
    function autoOf(el) {
      if (!autoMarks.length) { return false; }
      // v58：标记可能长在正文容器**外面**（拼多多机器人回复的「机器人」标签在
      // `.cs-item` 的头部，正文在 `.msg-content` 里）。画像 `auto_message_scope`
      // 给了就在那一层里找，空着照旧只在正文容器里找。
      var box = (a.autoScope && el.closest(a.autoScope)) ||
        (a.messageContent && el.closest(a.messageContent)) || el;
      var leaves = box.querySelectorAll('*');
      for (var q = 0; q < leaves.length && q < 300; q++) {
        if (leaves[q].children.length !== 0) { continue; }
        var lt = squeeze(leaves[q].textContent || '');
        if (lt !== '' && autoMarks.indexOf(lt) !== -1) { return true; }
      }
      return false;
    }
    var idSel = a.messageIdAttr ? '[' + a.messageIdAttr + ']' : '';
    function identityOf(el, fallback) {
      if (idSel) {
        var h = el.closest(idSel) || el.querySelector(idSel);
        var v = h ? String(h.getAttribute(a.messageIdAttr) || '').trim() : '';
        if (v !== '') { return v; }
      }
      return fallback;
    }

    while (walker.nextNode()) {
      var el = walker.currentNode;
      nodeCount += 1;

      // 时间标签：**必须排除消息本身**。买家完全可能发一条正文就是「15:30」
      // 的消息，把它当成时间标签会让后面每一条消息的身份都错位。
      if (!el.matches(a.messageText) && !el.closest(a.messageContent) && isTimeLabel(el)) {
        curTime = (el.textContent || '').trim();
        inGroup = 0;
        continue;
      }

      // 商品卡片消息。**必须排在图片那一支前面。**
      //
      // 卡里有商品缩略图，而闲鱼没配 `messageImage` —— 图片那一支于是退到
      // 「随便一个 img」，把整张商品卡当成买家发的图片，记成「[图片]」，
      // 还会按 `transfer.on_image_message` 去开一条转人工。
      //
      // 判据同样是结构的：一个消息容器里有商品卡、而且里面没有文字气泡。
      // 没配 `messageProductCard` 的平台整支跳过，行为与加它之前一模一样。
      if (
        !el.matches(a.messageText) &&
        a.messageContent &&
        a.messageProductCard &&
        el.matches(a.messageContent)
      ) {
        var card = null;
        try { card = el.querySelector(a.messageProductCard); } catch (e) { card = null; }
        // 字样过滤。快手那张卡从里到外都是 `kope-view` 加内联样式，一个
        // 可认的类名都没有，只能靠「咨询的商品」这几个字把它和别的卡分开。
        var cardNeedle = String(a.messageProductCardNeedle || '');
        if (
          card &&
          cardNeedle !== '' &&
          squeeze(card.innerText || card.textContent || '').indexOf(cardNeedle) === -1
        ) {
          card = null;
        }
        // v59：配了价格选择器（抖店）就以价格为锚取商品名；**卡里没有价格就不是商品
        // 卡**（地址修改、退款这类系统卡），不进这一支。
        var pricedTitle = null;
        if (card && a.messageProductCardPrice) {
          pricedTitle = titleNearPrice(card, a.messageProductCardPrice);
          if (pricedTitle === null) { card = null; }
        }
        if (card && !el.querySelector(a.messageText)) {
          if (messages.length >= MAX_MESSAGES) { capped = true; break; }
          var cardTitleText = pricedTitle !== null ? pricedTitle : cardTitle(card, a.messageProductCardTitle);
          var cardId = cardProductId(card);
          // 方向按**那张卡**的位置判，不按容器 —— 与图片那一支同一个理由：
          // 抖店的容器横贯整行，它的中心永远在中线上。
          var cardSide = sideOf(card, a, root);
          // **判不出方向就不要把它放进 messages。**
          //
          // Rust 侧遇到 `side: null` 会让**整次读取报错**，这一轮全废
          // （「没有给它猜一个方向：猜错会让 AI 对着自己说过的话生成回复」）。
          // 闲鱼这类平台的左右判据带 `text` 字样、只匹配文字气泡，卡片只能
          // 靠几何判 —— 卡还没渲染出来时宽度是 0，几何就回 null。
          //
          // 拿一条「本来根本读不到的消息」去换「整家店这一轮读不到」，方向
          // 反了。所以这里退回原来的行为（这一条不进记录），但**商品仍然
          // 记下来** —— 那是这一支最值钱的部分，而它不依赖方向。
          if (cardTitleText || cardId) {
            cardsSeen.push({ title: cardTitleText, id: cardId });
          }
          if (cardSide) {
            inGroup += 1;
            messages.push({
              body: '',
              isImage: false,
              imageSrc: '',
              isProduct: true,
              productTitle: cardTitleText,
              productId: cardId,
              side: cardSide,
              ts: identityOf(el, curTime === null ? '' : curTime + '#' + inGroup),
              time: timeOf(el),
              auto: autoOf(el)
            });
          } else {
            dropped.push({ why: 'card-no-side', cls: clsOf(el), text: sq90(el) });
          }
          continue;
        }
      }

      // 图片消息。**它不匹配 `messageText`** —— 那条选择器只认文字气泡
      // （闲鱼是 `message-text--`），所以图片消息此前整条被跳过：既不显示，
      // 也不触发转人工，全程无声。
      //
      // 判据是结构的，不是类名的：一个消息容器里有 `<img>`、而且里面没有
      // 文字气泡。类名会随改版变，「图片消息里有一张图」不会。
      if (!el.matches(a.messageText) && a.messageContent && el.matches(a.messageContent)) {
        // 有 `messageImage` 就指名道姓地找那张图 —— 抖店的容器里头像也是
        // `<img>`，「随便一个 img」会把头像当成买家发的图。
        //
        // **闲鱼没配它**，走的是「随便一个 img」那条。商品卡已经被上面那一支
        // 接走了，但订单卡、优惠券卡这些同样带图，仍然可能被当成买家发的图片
        // （记成「[图片]」并按 `transfer.on_image_message` 开转人工）。
        //
        // 2026-09-19 一度想加一道「容器里文字超过 N 个字就不当图片」的通用闸。
        // **撤掉了**：它的失败方向不对称 —— 闲鱼真正的图片消息容器里要是带了
        // 时间、「已读」这类小字超过阈值，就把一个本来работ得好好的功能静默
        // 关掉，而它要防的那件事只是推测，没有真机证据。用猜出来的阈值换一个
        // 能工作的功能，方向反了。
        //
        // 正解是给闲鱼探一条真的 `message_image`，那要真机 DOM。
        var img = a.messageImage ? el.querySelector(a.messageImage) : el.querySelector('img');
        if (img && !el.querySelector(a.messageText)) {
          if (messages.length >= MAX_MESSAGES) { capped = true; break; }
          inGroup += 1;
          messages.push({
            body: '',
            isImage: true,
            imageSrc: img.currentSrc || img.src || '',
            // 方向按**那张图**的位置判，不按容器：抖店的容器横贯整行，
            // 它的中心永远在中线上。
            side: sideOf(a.messageImage ? img : el, a, root),
            ts: identityOf(el, curTime === null ? '' : curTime + '#' + inGroup),
            time: timeOf(el),
            auto: autoOf(el)
          });
          continue;
        }
      }

      if (!el.matches(a.messageText)) {
        // **被丢掉的消息容器记一笔。只上报，不改行为。**
        //
        // 这个 while 只认两类半：文字气泡、图片消息、商品卡片。其余一律
        // 走到这里被丢掉 —— 不报错、不占位、不进记录。图片消息这样丢过
        // 一次，商品卡片这样丢过第二次（2026-09-19 抖店：买家把卡拍过来，
        // AI 三轮都说「没收到」）。**还会有第三次**：订单卡、优惠券卡、
        // 语音、视频都是同样的形状。
        //
        // 直接加一条「凡是有文字就收下」的兜底不行：小红书的 `message_text`
        // 里特意写着 `:not(.is-center)`，说明它有居中的系统消息被有意排除；
        // 一条兜底会把那些重新收进来，而居中的东西按几何判方向是掷硬币，
        // 掷错就是 AI 对着系统提示回话。
        //
        // 所以先让看不见的东西显形：把丢掉的形状报上去，由日志告诉我们
        // 每个平台上到底还有哪些类型，再逐类加精确的分支。
        if (a.messageContent && el.matches(a.messageContent) && !el.querySelector(a.messageText)) {
          if (dropped.length < MAX_DROPPED) {
            dropped.push({ why: 'unknown-kind', cls: clsOf(el), text: sq90(el) });
          }
        }
        continue;
      }
      if (messages.length >= MAX_MESSAGES) { capped = true; break; }

      inGroup += 1;
      messages.push({
        body: el.innerText || el.textContent || '',
        isImage: false,
        imageSrc: '',
        side: sideOf(el, a, root),
        ts: identityOf(el, curTime === null ? '' : curTime + '#' + inGroup),
        time: timeOf(el),
        auto: autoOf(el)
      });
    }

    // 「对方正在输入」：配了选择器且那个元素此刻可见。没配一律 false。
    var typing = false;
    if (a.typingIndicator) {
      try {
        var ind = document.querySelector(a.typingIndicator);
        typing = !!(ind && ind.getClientRects && ind.getClientRects().length > 0);
      } catch (e) { typing = false; }
    }

    var ids = identities();
    var buyer = activeBuyer(a.conversationActive, { input: a.input, prefix: a.activePlaceholderPrefix }, a.conversationNick, a);
    var prod = product();
    // 抖店：商品**只在接口里**（`get_consulting_products`）。它同时给 id 和
    // 标题，且比 DOM 那张卡可靠 —— 卡片可能已经滚出视野、是上一件的。
    // 闲鱼那条（`product()`）已经拿到东西时不覆盖。
    if (!prod.id && !prod.title) {
      var fromApi = productFromConsulting();
      if (fromApi.id || fromApi.title) { prod = fromApi; }
    }
    // 商品标题从 DOM 读（抖店：「用户正在查看商品」那张卡）。取**最后一张**
    // —— 买家看完一件又看一件，最后那件才是他此刻问的。接口路（闲鱼）优先。
    if (!prod.title && a.productTitle) {
      var domTitle = productTitleFromDom(root, a);
      if (domTitle) { prod = { title: domTitle, id: prod.id }; }
    }
    // id 还是空的话再走两条专属路：小红书在 DOM 属性上，快手在每条消息上。
    // **只补 id，不动标题** —— 标题上面已经按优先级定好了。
    if (!prod.id) {
      var idFromDom = productIdFromDom(root, a);
      if (idFromDom) { prod = { title: prod.title, id: idFromDom }; }
    }
    if (!prod.id) {
      var idFromMsg = productIdFromMessages(root, a);
      if (idFromMsg) { prod = { title: prod.title, id: idFromMsg }; }
    }
    // 最后一条**商品卡片消息**。买家把卡片拍过来说「这个」，那就是他问的
    // 那件 —— 而在这一支加上之前，那张卡连进都进不了会话记录。
    //
    // # 为什么只在两样都空时才用，而且两样都从同一张卡上取
    //
    // 标题空着、只拿卡上的 id 来补，会拼出「系统卡上 A 的标题 + 买家卡上
    // B 的 id」这样一件不存在的商品，而且看起来完全正常 —— 那正是
    // `pipeline::run` 里「标题与 id 各自兜底，但换了商品时标题的兜底要断掉」
    // 那段防的事。两样都从同一张卡取，就不存在配错的可能。
    //
    // # 为什么是最后一张，不分买家发的还是我们发的
    //
    // 与抖店那个接口「取最后一件」同一个道理：买家看完一件又看一件，最后
    // 那件才是他此刻问的。我们自己发出去的推荐卡也照收 —— 那一张管线已经
    // 按 `ProductSource::Ours` 记过一次，两处说的是同一件事。
    if (!prod.id && !prod.title && cardsSeen.length) {
      var lastCard = cardsSeen[cardsSeen.length - 1];
      prod = { title: lastCard.title || '', id: lastCard.id || '' };
    }
    return {
      messages: messages,
      nodeCount: nodeCount,
      capped: capped,
      buyerNick: buyer.nick,
      activeCount: buyer.count,
      selfNick: ids.self,
      selfNicks: ids.selfNames,
      knownNicks: ids.nicks,
      product: prod.title,
      productId: prod.id,
      typing: typing,
      dropped: dropped
    };
  };

  // ---- 发现与切换 --------------------------------------------------------
  //
  // 这两个 op 让软件从「当前会话助手」变成会自己找上门的 AI 客服。
  // 判断仍然全留在 Rust 侧：这里只负责「看见了什么」和「做了什么」。

  // 会话项的昵称。**和 `activeBuyer` 用同一条判据**（第一个有文字的叶子
  // 节点）—— 两处若各写一份，改版时只会修好一处，另一处静默读到别的字段
  // （未读数 `4`、时间 `15:30`），而那看起来完全正常。
  //
  // 有 `sel`（画像的 `conversation_nick`）就指名道姓：取那个元素的 `title`，
  // 没有 `title` 才取文字。没有 `sel` 时仍走形状判据，但**跳过长得像未读数
  // 或时间的叶子**（`1`、`99+`、`15:30`）—— 抖店上新消息来时未读数排在
  // 昵称前面，2026-09-03 日志里就把「1」当成了买家名。
  function nickOf(item, sel) {
    if (sel) {
      var el = null;
      try { el = item.querySelector(sel); } catch (e) {
        throw new Error('昵称选择器不合法：' + String(e && e.message));
      }
      if (el) {
        var named = (el.getAttribute('title') || el.textContent || '').trim();
        return named === '' ? null : named;
      }
      return null;
    }
    var leaves = item.querySelectorAll('*');
    for (var i = 0; i < leaves.length; i++) {
      if (leaves[i].children.length !== 0) { continue; }
      var t = (leaves[i].textContent || '').trim();
      if (t === '') { continue; }
      if (/^\d{1,3}\+?$/.test(t) || /^\d{1,2}:\d{2}$/.test(t)) { continue; }
      return t;
    }
    return null;
  }

  // 有未读红点的会话项的昵称。
  //
  // 从**会话项**往里找红点，不是从红点往上找会话项。后者要写一条祖先
  // xpath（老工程的做法），而那条路径是页面结构的强假设，改版就断。
  // 这个元素看起来像一个未读红点吗。
  //
  // # 为什么按颜色，不只按类名
  //
  // `unread_marker` 那条选择器（默认 `[class*="unread"]`）从没在真机上
  // 验证过，而它没命中的表现是**永远发现不到待办买家**，安静地退回只
  // 处理当前会话 —— 商家看着列表里亮着的红点，软件说没人在等。
  //
  // 红点是所有聊天界面共通的形状：**一小块红底**，里面要么是个 1~2 位
  // 数字，要么什么都没有。类名会随改版变，这个形状不会。
  //
  // 判据故意收得很紧（尺寸、颜色、内容三条都要满足）：宁可漏，不可把
  // 每个头像都当成红点 —— 那会让我们每一轮都去切一遍所有会话。
  function looksLikeBadge(el) {
    var r, cs;
    try {
      r = el.getBoundingClientRect();
      cs = window.getComputedStyle(el);
    } catch (e) { return false; }
    // 太大的不是红点，是头像或整块卡片；零尺寸的是隐藏元素。
    if (r.width < 6 || r.height < 6 || r.width > 34 || r.height > 34) { return false; }
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') { return false; }
    var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(cs.backgroundColor || '');
    if (!m) { return false; }
    var red = +m[1], green = +m[2], blue = +m[3], alpha = m[4] === undefined ? 1 : +m[4];
    if (alpha < 0.5) { return false; }
    // 红：红色分量高，且明显压过另外两个。橙色的角标也算（闲鱼是正红，
    // 别的平台有用橙的）。
    if (red < 170 || green > 140 || blue > 140) { return false; }
    if (red - green < 60 || red - blue < 60) { return false; }
    // 里面要么是空的，要么是个短数字（"1"、"12"、"99+"）。一段文字
    // 落在红底上的多半是标签，不是未读数。
    var t = (el.textContent || '').trim();
    if (t.length > 3) { return false; }
    if (t.length > 0 && !/^\d{1,2}\+?$/.test(t)) { return false; }
    return true;
  }

  // 这个会话项有未读吗。先按配置的选择器，认不出再按红点形状。
  //
  // v27（2026-09-05）：**按分组认。** 快手客服工作台把会话按状态分组
  // （「请在3分钟内回复」「已超时」「已回复」「已自动回复」），卡片自己身上
  // 没有红点也没有稳定的倒计时 —— 平台一发自动消息，倒计时就没了、会话
  // 挪进「已自动回复」组。会话在哪个组里才是待办的真相。画像给出分组容器、
  // 分组名元素和算待办的那几个组名，这里只执行；配了分组就以分组为准，
  // 不再退到红点形状 —— 已回复组里的卡也带着时间文字，退回去会误判。
  function hasUnread(item, marker, textPattern, group) {
    if (group && group.item && group.name && Array.isArray(group.pending) && group.pending.length) {
      var box;
      try { box = item.closest(group.item); } catch (e0) {
        throw new Error('分组容器选择器不合法：' + String(e0 && e0.message));
      }
      if (!box) { return null; }
      var nameEl = null;
      try { nameEl = box.querySelector(group.name); } catch (e1) {
        throw new Error('分组名选择器不合法：' + String(e1 && e1.message));
      }
      var gname = squeeze(nameEl ? (nameEl.textContent || '') : '');
      for (var gi = 0; gi < group.pending.length; gi++) {
        var want = squeeze(group.pending[gi] || '');
        if (want !== '' && gname.indexOf(want) !== -1) { return 'group'; }
      }
      return null;
    }
    if (marker) {
      try { if (item.querySelector(marker)) { return 'marker'; } } catch (e) {
        throw new Error('未读标记选择器不合法：' + String(e && e.message));
      }
    }
    // 计时器文字（抖店）：会话项里某个叶子的整段文字符合规律，
    // 例如「20秒」「1分22秒」「3分钟」。正则由画像给，这里只执行。
    if (textPattern) {
      var re;
      try { re = new RegExp(textPattern); } catch (e2) {
        throw new Error('未读文字规律不是合法正则：' + String(e2 && e2.message));
      }
      var leaves = item.querySelectorAll('*');
      for (var t = 0; t < leaves.length && t < 200; t++) {
        if (leaves[t].children.length !== 0) { continue; }
        var leafText = (leaves[t].textContent || '').trim();
        if (leafText !== '' && re.test(leafText)) { return 'timer'; }
      }
    }
    var all = item.querySelectorAll('*');
    for (var i = 0; i < all.length && i < 200; i++) {
      if (looksLikeBadge(all[i])) { return 'badge'; }
    }
    return null;
  }

  // 未读的**权威来源：页面自己的接口**。
  //
  // # 为什么它比 DOM 可靠
  //
  // DOM 上的红点是接口的渲染结果。类名会随构建哈希变、颜色会随改版变、
  // 尺寸会随缩放变 —— 而 `unreadCount: 3` 这个字段不会。前两条判据
  // （配置的选择器、红点形状）都是在猜页面长什么样，这一条是问它本身。
  //
  // # 为什么它不能单独用
  //
  // **接口给的昵称是打码的**（`d***o`），而 DOM 上是完整的。切会话要按
  // 完整昵称点，拿打码的名字点不中 —— `profile.rs` 里那条「发现必须走
  // DOM」的说明记的就是这件事。
  //
  // 所以它在这里的用法是：拿打码的名字去**唯一地**认出列表里的某一项。
  // 认不出（零个或多个匹配）就放弃这一条，不猜 —— 猜错是服务了另一个买家。
  var UNREAD_KEYS = [
    'unread', 'unreadCount', 'unReadCount', 'unreadNum', 'unReadNum',
    'noReadNum', 'redPoint', 'redPointNum'
  ];

  function unreadOf(o) {
    for (var i = 0; i < UNREAD_KEYS.length; i++) {
      var v = o[UNREAD_KEYS[i]];
      if (typeof v === 'number' && v > 0) { return v; }
      if (typeof v === 'string' && /^[1-9]\d*$/.test(v)) { return +v; }
    }
    return 0;
  }

  // 接口里说有未读的那些人（名字可能是打码的），以及未读总数。
  function apiUnread() {
    var out = { total: 0, masked: [] };
    var apis = [
      'mtop.taobao.idlemessage.pc.redpoint.query',
      'mtop.taobao.idlemessage.pc.session.sync'
    ];
    for (var a = 0; a < apis.length; a++) {
      var body = parseKept(apis[a]);
      if (!body) { continue; }
      var hits = findAll(body, function (o) { return unreadOf(o) > 0; }, [], 0);
      for (var i = 0; i < hits.length; i++) {
        out.total += unreadOf(hits[i]);
        // 名字可能挂在这个对象上，也可能挂在它的 `userInfo` 里。两处都收。
        var names = namesOf(hits[i]).concat(namesOf(hits[i].userInfo));
        for (var k = 0; k < names.length; k++) {
          if (out.masked.indexOf(names[k]) === -1) { out.masked.push(names[k]); }
        }
      }
    }
    return out;
  }

  function escRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // 拿一个打码的名字（`d***o`）去认列表里的某一项。
  //
  // **只在唯一命中时才认。** 零个命中说明这个人不在可见的列表里（虚拟
  // 滚动），多个命中说明这个模式分不清谁是谁 —— 两种情况都放弃，不猜。
  // 猜错的后果是服务了另一个买家，而那不可撤回。
  function matchMasked(masked, nicks) {
    if (masked.indexOf('*') === -1) {
      return nicks.indexOf(masked) !== -1 ? masked : null;
    }
    var hits = [];
    // 先按「打码保留长度」试：每个 * 换成一个任意字符。
    var exact = new RegExp('^' + masked.split('').map(function (c) {
      return c === '*' ? '.' : escRe(c);
    }).join('') + '$');
    for (var i = 0; i < nicks.length; i++) {
      if (exact.test(nicks[i])) { hits.push(nicks[i]); }
    }
    if (hits.length === 0) {
      // 再按「不保留长度」试：连续的 * 换成任意长度。
      var loose = new RegExp('^' + masked.split(/\*+/).map(escRe).join('.*') + '$');
      for (var j = 0; j < nicks.length; j++) {
        if (loose.test(nicks[j])) { hits.push(nicks[j]); }
      }
    }
    return hits.length === 1 ? hits[0] : null;
  }

  ops.pendingChats = function (args) {
    var a = args || {};
    // 拼多多：会话列表读页面自己的数据（见 `pddPending`）。键与 DOM 那条路的
    // `keyOf` 同形（`昵称#买家id`），`activateChat` 照旧在 DOM 里按它找会话项去点。
    if (a.chatStore === 'pdd') {
      var storePending = pddPending(a);
      if (storePending) { return storePending; }
    }
    var items;
    try { items = document.querySelectorAll(a.conversationItem); } catch (e) {
      throw new Error('会话项选择器不合法：' + String(e && e.message));
    }
    // 一个都匹配不上 = 选择器失效或页面还没加载完。**必须和「有列表但
    // 都已读」分开报** —— 前者是故障（我们从此再也发现不了任何买家），
    // 后者是正常空闲。压成同一个空列表就是静默漏单。
    var blocked = Array.isArray(a.blocklist) ? a.blocklist : [];
    var pending = [];
    var via = null;
    for (var i = 0; i < items.length; i++) {
      var how = hasUnread(items[i], a.unreadMarker, a.unreadTextPattern, a.pendingGroup);
      if (!how) { continue; }
      if (via === null || how === 'marker' || how === 'timer' || how === 'group') { via = how; }
      var nick = nickOf(items[i], a.conversationNick);
      if (!nick) { continue; }
      if (blocked.indexOf(nick) !== -1) { continue; }
      var key = keyOf(items[i], a.conversationNick, a.buyerIdPattern, a.buyerIdAttr);
      if (pending.indexOf(key) === -1) { pending.push(key); }
    }
    // 有会话项、却一个未读标记都没命中 —— 把**看到的类名**报回去。
    //
    // 这不是调试残留。`unread_marker` 那条选择器从来没在真机上验证过
    // （`profile.rs` 里 `verified.unread_matcher = false`），而它没命中的
    // 表现是「永远发现不到待办买家」，安静地退回只处理当前会话。
    //
    // 光报「没命中」没用，我们仍然不知道该改成什么。把类名带回去，一次
    // 真机运行就能定下正确的选择器。
    // ③ 接口那一路。**最后跑** —— 前两条认出来的名字是从 DOM 直接读的，
    //    不需要经过打码匹配；这一路只补它们漏掉的。
    var api = apiUnread();
    if (api.masked.length > 0) {
      var nicks = [];
      for (var n = 0; n < items.length; n++) {
        var one = nickOf(items[n], a.conversationNick);
        if (one && nicks.indexOf(one) === -1) { nicks.push(one); }
      }
      for (var mi = 0; mi < api.masked.length; mi++) {
        var full = matchMasked(api.masked[mi], nicks);
        if (!full) { continue; }
        if (blocked.indexOf(full) !== -1) { continue; }
        if (pending.indexOf(full) !== -1) { continue; }
        pending.push(full);
        if (via === null) { via = 'api'; }
      }
    }

    var hint = null;
    if (pending.length === 0 && items.length > 0) {
      var seen = {};
      for (var h = 0; h < items.length && h < 5; h++) {
        var all = items[h].querySelectorAll('*');
        for (var k = 0; k < all.length && k < 120; k++) {
          var cn = all[k].className;
          if (typeof cn !== 'string') { continue; }
          var parts = cn.split(/\s+/);
          for (var q = 0; q < parts.length; q++) {
            if (parts[q]) { seen[parts[q]] = 1; }
          }
        }
      }
      hint = Object.keys(seen).slice(0, 60);
    }
    return {
      itemCount: items.length,
      pending: pending,
      classHint: hint,
      via: via,
      apiUnread: api.total
    };
  };

  // 切到指定昵称的会话。
  //
  // 同一个买家在列表里可以有多项 —— 闲鱼按「买家 × 商品」开会话，一个人
  // 问两件东西就是两条。同名时挑带未读的那一项（正文见下面 v38 那段）。
  ops.activateChat = function (args) {
    var a = args || {};
    var items;
    try { items = document.querySelectorAll(a.conversationItem); } catch (e) {
      throw new Error('会话项选择器不合法：' + String(e && e.message));
    }
    // **已经停在这个买家的会话上就不点、不等。** 切换之后固定要等 1.5 秒
    // 页面渲染，而每一轮都切一次 —— 一次回复至少切两次，白等 3 秒
    // （2026-09-03 日志量出来的）。判据与 `readChat` 认「当前买家」用的
    // 是同一个函数，两边不会各认各的。
    var cur = activeBuyer(a.conversationActive, { input: a.input, prefix: a.activePlaceholderPrefix }, a.conversationNick, a);
    var curIsTarget = cur.count === 1 && cur.nick !== null && cur.nick === a.target;
    var hits = [];
    for (var i = 0; i < items.length; i++) {
      if (keyOf(items[i], a.conversationNick, a.buyerIdPattern, a.buyerIdAttr) === a.target) { hits.push(items[i]); }
    }
    // 只有一项（或列表里找不到、但当前就停在他身上）时才走这条捷径。
    // 同名多项时**不能**走：刚回完商品 A，页面停在 A 上，同一买家商品 B 的
    // 红点亮了 —— 「当前买家 = 目标」成立，可该点的是 B。
    if (hits.length <= 1 && curIsTarget) {
      return { switched: true, already: true };
    }
    if (hits.length === 0) { return { switched: false, reason: 'gone' }; }
    var picked = hits[0];
    var duplicates = 0;
    if (hits.length > 1) {
      // v38（2026-09-07）：**同名的几项里挑一项，不再放弃。**
      //
      // 这里原先直接抛错「无法确定是哪一个」。闲鱼按「买家 × 商品」开会话，
      // 一个人问两件东西就是两项（真机：两个「用户_596514498」），于是每一
      // 轮都切不过去，连着三次就触发自愈重载页面 —— 每来一条消息就刷一次。
      //
      // 几项的 key 相同，也就是同一个买家；差别只在商品。挑法：
      //   1. 带未读的那一项 —— 要回的正是它。两项都带，先答一项，答完
      //      红点清掉，下一轮 `pendingChats` 再报这个买家时挑到另一项。
      //   2. 一项都不带未读：当前打开的那一项就是它（人工代发时商家刚点开
      //      的、或 AI 刚回过的）。
      //   3. 都不带、也没打开任何一项：**报 ambiguous，不点。** 点第一项是
      //      猜，猜错就把话发进另一件商品的会话。Rust 侧当「切不过去」处理：
      //      AI 那条路跳过（不计自愈次数），人工代发那条路提示商家点开要回
      //      的那一条再发。
      //
      // 选中态用 `conversationActive` 判；配了输入框占位前缀的平台（快手）
      // 那条选择器只是占位，不能用 —— 见画像里的 `_active_note`。
      duplicates = hits.length;
      var activeSel = a.activePlaceholderPrefix ? '' : a.conversationActive;
      var visible = [];
      for (var v = 0; v < hits.length; v++) {
        if (hits[v].getClientRects && hits[v].getClientRects().length) { visible.push(hits[v]); }
      }
      if (visible.length === 0) { visible = hits; }
      var unread = [];
      for (var u = 0; u < visible.length; u++) {
        if (hasUnread(visible[u], a.unreadMarker, a.unreadTextPattern, a.pendingGroup)) { unread.push(visible[u]); }
      }
      if (unread.length > 0) {
        picked = unread[0];
        if (isActiveItem(picked, activeSel)) { return { switched: true, already: true, duplicates: duplicates }; }
      } else {
        for (var w = 0; w < visible.length; w++) {
          if (isActiveItem(visible[w], activeSel)) { return { switched: true, already: true, duplicates: duplicates }; }
        }
        return { switched: false, reason: 'ambiguous', duplicates: duplicates };
      }
      // 给点的那一项做记号：Rust 侧等「换过去」时，「当前买家 = 目标」在
      // 点之前就成立，不能当证据；它问的是**这一项**有没有拿到选中态
      // （`pickedActive`）。React 重建节点时记号会丢，那边按「不知道」处理。
      for (var m = 0; m < hits.length; m++) { hits[m].removeAttribute('data-shanhui-picked'); }
      picked.setAttribute('data-shanhui-picked', '1');
    }
    // v29（2026-09-05）：**点会话项里的哪一块**（画像 `conversation_click_target`）。
    //
    // 快手客服工作台的会话卡外层是 antd 的右键菜单触发器，真正「选中这个
    // 会话」的处理器挂在它**内层**的 `div.SessionBaseCard-Static` 上，而且
    // 那个处理器 `stopPropagation`。点外层卡片，事件从外层开始冒泡，永远
    // 到不了内层 —— 真机上点了三轮会话都没打开（日志 `settled: false,
    // pane_messages: 0`），商家手点一下才开。点内层那一块，普通 `.click()`
    // 就开了。不配就还是点会话项本身（闲鱼、抖店验过的老路）。
    var el = picked;
    if (a.clickTarget) {
      var inner = null;
      try { inner = picked.querySelector(a.clickTarget); } catch (e2) {
        throw new Error('会话项点击目标选择器不合法：' + String(e2 && e2.message));
      }
      if (!inner) {
        throw new Error('会话项里找不到该点的那一块（' + String(a.clickTarget) + '）—— 页面可能已改版');
      }
      el = inner;
    }
    // v58：**完整按一下**（画像 `conversation_click_press`，只有拼多多开）。拼多多的
    // 会话项能拖动（`data-move-dom`），选中靠「按下 → 松开 → 点击」这一整套，只派
    // 一个 click 它不认 —— 2026-11-09 真机：`.click()` 点了 1.8 秒没反应，补上
    // mousedown / mouseup 之后 150 毫秒就切过去了。它不查 `isTrusted`。
    if (a.clickPress) {
      var rc = el.getBoundingClientRect();
      var mo = {
        bubbles: true, cancelable: true, view: window, button: 0, buttons: 1,
        clientX: rc.left + rc.width / 2, clientY: rc.top + rc.height / 2
      };
      lastSwitchAt = Date.now();
      el.dispatchEvent(new MouseEvent('mousedown', mo));
      mo.buttons = 0;
      el.dispatchEvent(new MouseEvent('mouseup', mo));
      el.dispatchEvent(new MouseEvent('click', mo));
      return { switched: true, duplicates: duplicates };
    }
    lastSwitchAt = Date.now();
    el.click();
    return { switched: true, duplicates: duplicates };
  };

  // ---- 写入通道 ------------------------------------------------------------
  //
  // 三个 op 各做一步，**判断全部留在 Rust 侧**：读回一不一致、清空了没有，
  // 都由 Rust 比对。页面侧只负责「做」和「如实报告做完之后是什么样」。
  //
  // 这么切是因为「写进去了」和「页面知道你写了」是两件事：`<textarea>` 是
  // React 受控组件，直接赋 `.value` 而不派发正确的事件，页面的状态根本不知道
  // 你写了什么 —— 而 DOM 上看起来一切正常。让页面自己判断「成功了吗」，
  // 等于让那个正好失效的东西给自己打分。

  // 去掉所有空白。见 `commit` 里比较按钮文字那一段的说明。
  function squeeze(t) {
    return String(t).replace(/\s+/g, '');
  }

  // 唯一定位。**匹配到多个就报错，绝不取第一个。**
  //
  // 取第一个是静默地猜：页面上可能有别的 textarea（搜索框、备注框），
  // 猜错的后果是回复写进了一个买家永远看不到的地方，而且没有任何报错。
  function theOnly(selector, what) {
    if (typeof selector !== 'string' || selector === '') {
      throw new Error('没有给出' + what + '的选择器');
    }
    var nodes;
    try {
      nodes = document.querySelectorAll(selector);
    } catch (e) {
      throw new Error('选择器 ' + selector + ' 不合法：' + String(e && e.message));
    }
    if (nodes.length === 0) {
      throw new Error('找不到' + what + '（选择器 ' + selector + '）—— 页面可能已改版，或当前没有打开会话');
    }
    if (nodes.length > 1) {
      throw new Error('匹配到 ' + nodes.length + ' 个' + what + '（选择器 ' + selector +
        '）—— 无法确定是哪一个，已中止；取第一个等于静默地猜');
    }
    return nodes[0];
  }

  // 写入。用原生 setter + 派发 input 事件 —— React 受控组件只认这条路。
  ops.write = function (args) {
    var el = theOnly(args && args.input, '输入框');
    var text = String((args && args.text) || '');
    // v27（2026-09-05）：**富文本输入框**（`contenteditable`，快手客服工作台
    // 用的是 Quill）。它没有 `value`，原生 setter 那条路对它一个字都写不进去。
    // 走浏览器自己的 `insertText` 命令：它派发的 `beforeinput` / `input` 与
    // 真人打字一模一样，Quill 靠这些事件更新自己的模型、点亮发送键。先全选
    // 再插入，等于替换掉输入框里原有的内容（与 textarea 那条路的语义一致）。
    if (el.isContentEditable) {
      el.focus();
      try { document.execCommand('selectAll', false, null); } catch (e) { /* 选不中就直接插 */ }
      var inserted = false;
      try { inserted = document.execCommand('insertText', false, text); } catch (e2) { inserted = false; }
      if (!inserted) {
        throw new Error('富文本输入框不接受 insertText —— 页面可能拦截了输入命令');
      }
      return { readback: String(el.innerText || ''), tag: 'contenteditable' };
    }
    var proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (!setter || typeof setter.set !== 'function') {
      throw new Error('拿不到输入框的原生 value setter —— 运行时可能已被改写');
    }
    el.focus();
    setter.set.call(el, text);
    // React 通过 input 事件更新它自己的状态。少了这一步，页面的状态里
    // 仍然是空的，点发送会发出一条空消息或者什么都不发。
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return { readback: el.value, tag: el.tagName.toLowerCase() };
  };

  // 用**平台自己的「发送商品」按钮**把一张商品卡片发给买家。
  //
  // # 为什么不发链接
  //
  // 在聊天里发一条商品链接最省事，千牛还会自动把淘宝链接渲染成卡片。但拼多多、
  // 抖店对聊天里的外链有风控，一条文字外链可能被判违规 —— 那和「不封号」那条
  // 底线直接冲突，而我们没有任何办法事先知道哪条会被拦。平台自己的按钮是它
  // 认可的路：商家天天在点，走的是平台内部的消息类型。
  //
  // # 四步，每一步失败都要说清楚是哪一步
  //
  //   1. 点开商品面板的那个页签（`panelTab`，可能已经开着）
  //   2. 在面板的搜索框里输入商品名（`search`）
  //   3. 在结果里找到标题对得上的那一行（`row` / `rowTitle`）
  //   4. 点那一行里写着 `sendText` 的按钮
  //
  // 错误信息里必须带上是第几步 —— 这条路上有四个各自独立的失效点，而它们在
  // 日志里长得一模一样（「没发出去」）。分不清的话，改版时只能从头验一遍。
  //
  // # 它不判断「成功了没有」
  //
  // 与 `pasteImage` 同一条：点完按钮之后卡片有没有真的发出去，只有页面自己
  // 知道，而问它等于让那个可能正好失效的东西给自己打分。判据在 Rust 侧 ——
  // 发完重读一次会话，最后一条出站消息是不是商品卡片。
  // 「面板开着没有」= 搜索框在不在、看不看得见。
  //
  // # 为什么不看页签上的 active 类
  //
  // 那是第一版的判据，只对快手成立（`.tabItem-goods` 开着时类名带 active）。
  // 闲鱼那个入口是发送区工具条上的一个**图标**（`item-icon--<hash>`），它
  // 永远没有 active —— 于是每次都会再点一下，而抽屉开着时再点一下就**关掉了**。
  // 那种错的表现是：日志里说每一步都成功，买家什么都没收到。
  //
  // 搜索框在不在是各家通用的、而且是**结果导向**的判据：它在且看得见，说明
  // 面板确实开着，不管这个平台的开法长什么样。
  function productPanelOpen(a) {
    if (!a.search) { return false; }
    var box = null;
    try { box = document.querySelector(a.search); } catch (e) { return false; }
    return !!(box && box.offsetParent !== null);
  }

  // 第 1 步：把商品面板打开。已经开着就什么都不做。
  ops.sendProductOpen = function (args) {
    var a = args || {};
    if (productPanelOpen(a)) { return { opened: false, already: true }; }
    if (!a.panelTab && !a.panelTabText) {
      // 有的平台面板一直在（小红书），没有入口要点。
      return { opened: false, already: false, note: '没有配入口' };
    }
    var tab = null;
    if (a.panelTab) {
      try { tab = document.querySelector(a.panelTab); } catch (e) { tab = null; }
    }
    if (!tab && a.panelTabText) {
      // 类名是每次构建都变的哈希时（抖店），只能按文字认。
      var all = document.querySelectorAll('*');
      for (var i = 0; i < all.length; i++) {
        if (all[i].children.length === 0 && (all[i].innerText || '').trim() === a.panelTabText) {
          tab = all[i];
          break;
        }
      }
    }
    if (!tab) { throw new Error('第 1 步：找不到商品面板的入口'); }
    tab.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return { opened: true };
  };

  // v59：发完商品卡把右侧面板切回原来那个页签（画像 `product_panel_restore_text`，
  // 抖店「订单」）。
  //
  // 抖店「咨询商品」那个接口是右侧「订单 → 咨询宝贝」那块在调的。我们发卡片时把面板
  // 切到了「商品」，不切回去的话之后切会话它都不再调，商品 id 只能靠聊天里的卡片猜。
  //
  // 只在**和商品面板入口同一排**的页签里找（从入口往外找到第一个同时含有这两个页签
  // 的容器）—— 「订单」两个字在聊天里的订单卡片上也可能出现。找不到就算了，这一步
  // 只是尽力而为，不影响卡片发没发出去。
  ops.restoreProductPanel = function (args) {
    var a = args || {};
    var want = String(a.restoreText || '').trim();
    var entry = String(a.panelTabText || '').trim();
    if (want === '' || entry === '') { return { restored: false, note: '没有配' }; }
    function visibleLeaf(text, scope) {
      var all = (scope || document).querySelectorAll('*');
      for (var i = 0; i < all.length; i++) {
        var e = all[i];
        if (e.children.length === 0 && e.offsetParent !== null && (e.innerText || '').trim() === text) { return e; }
      }
      return null;
    }
    var tab = visibleLeaf(entry, document);
    if (!tab) { return { restored: false, note: '找不到商品面板的入口' }; }
    for (var box = tab.parentElement; box; box = box.parentElement) {
      var target = visibleLeaf(want, box);
      if (target) {
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return { restored: true };
      }
    }
    return { restored: false, note: '和入口同一排里找不到「' + want + '」' };
  };

  // 第 1b 步：面板里再选一个子页签。**只在它还没选中时点。**
  //
  // 闲鱼的宝贝抽屉默认停在「TA的宝贝」上 —— 那是**买家**在卖的东西。不切到
  // 「我的宝贝」就搜自己的商品，一条都搜不到，页面写着「没有找到你搜索的
  // 宝贝哦～」（2026-09-18 真机，这个坑差点当成「搜索用不了」）。
  //
  // 按文字找页签，选中判据是类名里有 `activeClass` 指的那个词。两样都没配
  // 就什么都不做 —— 别的平台的面板没有这一层。
  ops.sendProductTab = function (args) {
    var a = args || {};
    var want = String(a.tabText || '').trim();
    if (want === '') { return { switched: false, note: '这个平台的面板没有子页签' }; }
    var sel = a.tabSelector || '*';
    var els;
    try { els = document.querySelectorAll(sel); } catch (e) { els = []; }
    for (var i = 0; i < els.length; i++) {
      if ((els[i].innerText || '').trim() !== want) { continue; }
      var cls = String(els[i].className || '');
      if (a.activeClass && cls.indexOf(a.activeClass) !== -1) {
        return { switched: false, already: true };
      }
      els[i].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return { switched: true };
    }
    throw new Error('第 1b 步：面板里找不到写着「' + want + '」的页签');
  };

  // 第 2 步：在面板的搜索框里输入商品名。
  //
  // **同名商品在店里是常态**，不搜一下就只能在首屏那几件里碰运气。
  ops.sendProductSearch = function (args) {
    var a = args || {};
    var title = String(a.title || '').trim();
    if (title === '') { throw new Error('没有给出商品名'); }
    if (!a.search) { return { searched: false, note: '这个平台没有配搜索框' }; }
    var box = null;
    try { box = document.querySelector(a.search); } catch (e) { box = null; }
    if (!box) { throw new Error('第 2 步：找不到商品面板的搜索框（面板可能没打开）'); }
    var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (!setter || typeof setter.set !== 'function') {
      throw new Error('第 2 步：拿不到输入框的原生 value setter');
    }
    box.focus();
    setter.set.call(box, title);
    box.dispatchEvent(new Event('input', { bubbles: true }));
    // 回车触发搜索。有的面板是边打边搜，那时这一下是多余的、也无害。
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    return { searched: true, title: title };
  };

  // 搜索结果出来之后，点那一行的发送按钮。**与 `sendProduct` 分成两次调用**，
  // 因为中间要等页面把结果拉回来 —— 而等待属于 Rust 侧（那里有预算和超时），
  // 页面里 `setTimeout` 等于把一次调用的时长交给一个我们不控制的东西。
  // # 认哪一行：**有商品 id 就按 id，没有才按标题**
  //
  // 小红书的每一行结果自己带着 `data-index=<商品id>`（2026-09-18 真机），那是
  // 身份本身 —— 按它认，同名不同规格的几件商品分得开、商家改标题也不受影响。
  // 快手的行上一个 id 属性都没有，只能按标题。
  //
  // 按标题时要求**归一化后完全相等**：只判「包含」的话，「男士休闲裤」会命中
  // 「男士休闲裤加绒款」—— 发错一件商品给买家，比不发糟得多。
  ops.sendProductPick = function (args) {
    var a = args || {};
    var wantId = String(a.productId || '').trim();
    var wantTitle = squeeze(String(a.title || ''));
    if (wantId === '' && wantTitle === '') { throw new Error('既没有商品 id 也没有商品名'); }
    var rows;
    try { rows = document.querySelectorAll(a.row); } catch (e) { rows = []; }
    if (!rows.length) { throw new Error('第 3 步：商品面板里一行结果都没有'); }
    var byId = wantId !== '' && a.rowIdAttr;
    var seen = [];
    for (var i = 0; i < rows.length; i++) {
      var hit = false;
      if (byId) {
        var got = rows[i].getAttribute(a.rowIdAttr);
        if (seen.length < 6 && got) { seen.push(String(got)); }
        hit = got !== null && String(got).trim() === wantId;
      } else {
        var t = '';
        if (a.rowTitle) {
          var el = rows[i].querySelector(a.rowTitle);
          t = el ? (el.innerText || el.textContent || '') : '';
        } else {
          // **没有稳定类名可配时（抖店：类名全是构建哈希）走结构判据：
          // 行里第一个够长的文字节点就是标题。**
          //
          // 这些商品卡都是标题打头，后面才是价、库存、标签。拿整行的文字比
          // 不行 —— 那样永远不会与标题全等；而放宽成「包含」就会让
          // 「男士休闲裤」命中「男士休闲裤加绒款」，发错一件给买家。
          var leaves = rows[i].querySelectorAll('*');
          for (var k = 0; k < leaves.length; k++) {
            if (leaves[k].children.length !== 0) { continue; }
            var lt = squeeze(leaves[k].innerText || leaves[k].textContent || '');
            if (lt.length >= 6) { t = lt; break; }
          }
        }
        t = squeeze(t);
        if (seen.length < 6) { seen.push(t.slice(0, 40)); }
        hit = t === wantTitle;
      }
      if (!hit) { continue; }
      var btns = rows[i].querySelectorAll('*');
      for (var j = 0; j < btns.length; j++) {
        if (btns[j].children.length !== 0) { continue; }
        if ((btns[j].innerText || '').trim() !== a.sendText) { continue; }
        btns[j].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return { clicked: true, by: byId ? 'id' : 'title' };
      }
      throw new Error('第 4 步：找到了那一行，但行里没有写着「' + a.sendText + '」的按钮');
    }
    throw new Error('第 3 步：搜索结果里没有对得上的那一行（按' + (byId ? '商品 id' : '标题') +
      '找，看到的前几条：' + seen.join(' | ') + '）');
  };

  // 第 5 步：重读会话，确认**真的发出去了、而且发的是那一件**。
  //
  // # 为什么这一步不可省
  //
  // 前四步全都可能「成功」而卡片并没有发出去：面板没真的打开、搜索结果是
  // 缓存的旧列表、点到的按钮被禁用、平台侧拒绝了。这四种在前四步的返回值里
  // 长得都像成功。这与发图那条路的第四步是同一条纪律 —— 千牛栽的两跤都只被
  // 读回核对抓住，**没有一次是靠返回值发现的**。
  //
  // # 判据：最后一张卡片上有没有那个商品 id
  //
  // 2026-09-18 真机（商家自己在闲鱼上发了一张）：发出去的卡片是
  // `<div data-spm="im_item_card">`，里面那个 `<a href>` 带着
  // `id=<商品id>`。`data-spm` 是语义属性不是构建哈希，认得住。
  //
  // 拿不到 id 的平台退回按标题比 —— 弱一些，但比不核对强。两样都没有就
  // 回 `checked: false`，由 Rust 侧照实记一行「没核对」。
  ops.verifyProductSent = function (args) {
    var a = args || {};
    var all;
    try { all = document.querySelectorAll(a.card); } catch (e) { all = []; }
    if (!a.card) { return { checked: false, why: '这个平台没有配已发卡片的选择器' }; }
    // 字样过滤。**有的平台的商品卡片一个可认的类名都没有**（快手：整张卡
    // 从里到外都是 `kope-view` 加内联样式），只能靠卡上那几个固定的字
    // （「咨询的商品」）把它和文字消息分开。
    //
    // 分不开的后果不是「认不出」，是**认错**：我们那条文字回复里本来就写着
    // 商品名，卡片没发出去时最后一条就是它 —— 按标题一比正好对上，于是一次
    // 失败被核成了成功。这与画像里 `product_card_needle` 存在的理由一模一样。
    var needle = squeeze(String(a.needle || ''));
    var cards = [];
    for (var n = 0; n < all.length; n++) {
      if (needle === '' || squeeze(all[n].innerText || all[n].textContent || '').indexOf(needle) !== -1) {
        cards.push(all[n]);
      }
    }
    if (!cards.length) { return { checked: true, ok: false, why: '会话里一张商品卡片都没有' }; }
    var last = cards[cards.length - 1];
    var html = last.outerHTML || '';
    var text = squeeze(last.innerText || last.textContent || '');
    var wantId = String(a.productId || '').trim();
    var wantTitle = squeeze(String(a.title || ''));
    // **先按 id，认不到再按标题。**
    //
    // 闲鱼发出去的卡片里那个 `<a href>` 带着 `id=<商品id>`，那是最硬的证据。
    // 抖店的卡片（`.chatd-card`）里一个 id 都没有，只有标题 —— 那时按标题
    // 比仍然证明「一张写着这件商品的卡片出去了」，比不核对强得多。
    //
    // 顺序不能反：按标题先比会让「id 对不上但标题恰好包含」蒙混过关，而
    // 同店同名不同规格的商品正是这种形状。
    if (wantId !== '' && html.indexOf(wantId) !== -1) {
      return { checked: true, ok: true, by: 'id', saw: text.slice(0, 60) };
    }
    if (wantTitle !== '' && text.indexOf(wantTitle) !== -1) {
      return { checked: true, ok: true, by: 'title', saw: text.slice(0, 60) };
    }
    if (wantId === '' && wantTitle === '') {
      return { checked: false, why: '既没有商品 id 也没有标题' };
    }
    return { checked: true, ok: false, saw: text.slice(0, 60) };
  };

  // 当前输入框里是什么。后置条件核对（清空了没有）用它。
  // 往输入框「粘贴」一张图。**不碰系统剪贴板。**
  //
  // # 为什么是派发 paste 事件，不是走剪贴板
  //
  // 走系统剪贴板要占用商家自己的剪贴板（他复制的东西被我们冲掉），而且
  // 要抢焦点才能触发 Ctrl+V。这里我们**在页面内部**造一个 `DataTransfer`，
  // 把图作为 `File` 挂进去，再往输入框派一次 `paste` —— 页面的粘贴处理
  // 逻辑收到的东西和用户真按 Ctrl+V 时一模一样，而系统剪贴板一个字节
  // 都没动。
  //
  // # 为什么整段是同步的
  //
  // `fetch(dataUrl).blob()` 更短，但它是异步的，而这条路上多一个 Promise
  // 就多一个「派发之前页面被切走了」的窗口。`atob` + `Uint8Array` 同样
  // 有效，且一口气跑完。
  //
  // # 它不判断「成功了没有」
  //
  // 页面接没接住这张图，只有它自己知道，而问它等于让那个可能正好失效的
  // 东西给自己打分。真正的判据在 Rust 侧：发完重读一次会话，最后一条
  // 出站消息是不是图片消息。见 `web::chat::send::send_image`。
  ops.pasteImage = function (args) {
    var a = args || {};
    var el;
    try { el = document.querySelector(a.input); } catch (e) {
      throw new Error('输入框选择器不合法：' + String(e && e.message));
    }
    if (!el) { throw new Error('输入框不在（' + String(a.input) + '）'); }

    var bin;
    try { bin = atob(String(a.base64 || '')); } catch (e) {
      throw new Error('图片数据不是合法的 base64');
    }
    if (bin.length === 0) { throw new Error('图片数据是空的'); }
    var buf = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) { buf[i] = bin.charCodeAt(i); }

    var file;
    try {
      file = new File([buf], String(a.name || 'image.png'), { type: String(a.mime || 'image/png') });
    } catch (e) {
      throw new Error('这个页面里造不出 File 对象：' + String(e && e.message));
    }

    var dt;
    try {
      dt = new DataTransfer();
      dt.items.add(file);
    } catch (e) {
      throw new Error('这个页面里造不出 DataTransfer：' + String(e && e.message));
    }

    // v30（2026-09-05）：**页面上现成的那个 file input**（画像
    // `image_file_input`）。三条发图路里最干净的一条：小红书千帆工具条里
    // 那个图片图标下面就挂着一个 `input[type=file][accept*="image/"]`，
    // 一直在 DOM 里 —— 不用点、不用截、不用派 paste 事件。
    //
    // 与快手那条（点按钮、截住它唤起的 input）的差别只在于「input 要不要
    // 先唤出来」，塞文件那一下是同一套：`files = DataTransfer.files` 再派
    // `input` + `change`。
    if (a.fileInput) {
      var picker;
      try { picker = document.querySelector(a.fileInput); } catch (e) {
        throw new Error('发图输入元选择器不合法：' + String(e && e.message));
      }
      if (!picker) {
        throw new Error('找不到发图用的文件输入元（' + String(a.fileInput) + '）—— 页面可能已改版，或当前没有打开会话');
      }
      try {
        picker.files = dt.files;
        picker.dispatchEvent(new Event('input', { bubbles: true }));
        picker.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (e2) {
        throw new Error('把图交给文件输入元失败：' + String(e2 && e2.message));
      }
      return { dispatched: true, bytes: buf.length, via: 'fileInput' };
    }

    // v28（2026-09-05）：**走页面自己的「图片」按钮**（画像 `image_pick_button`）。
    //
    // 快手客服工作台不吃 paste 事件、也不吃拖放（真机各试过一遍，输入框
    // 纹丝不动）。它的图片图标点一下会唤起一个隐藏的 `<input type=file>`，
    // 选完文件就直接发出去。所以这里照着人的动作来：点那个图标，把它唤起
    // 的那个 input 截下来（不让系统文件框弹出来），把文件塞进去、派一次
    // `change`。截法与 `clickRowEdit` 截 `window.open` 同一条纪律 —— 只在
    // 这一次点击期间替换 `HTMLInputElement.prototype.click`，`finally` 里
    // 还回去；文件框只是不弹，页面别的一切照旧。
    //
    // 唤起是异步的（React 的事件处理里 `input.click()`），所以这个 op 返回
    // Promise，等 800 毫秒再塞文件。
    if (a.pickButton) {
      var btn;
      try { btn = document.querySelector(a.pickButton); } catch (e) {
        throw new Error('发图按钮选择器不合法：' + String(e && e.message));
      }
      if (!btn || !btn.getClientRects || btn.getClientRects().length === 0) {
        throw new Error('找不到发图按钮（' + String(a.pickButton) + '）—— 页面可能已改版，或当前没有打开会话');
      }
      var picked = null;
      var origClick = HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click = function () {
        if (this.type === 'file') { picked = this; return; }
        return origClick.apply(this, arguments);
      };
      try {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      } catch (e2) {
        HTMLInputElement.prototype.click = origClick;
        throw new Error('点发图按钮失败：' + String(e2 && e2.message));
      }
      return new Promise(function (resolve, reject) {
        later(function () {
          HTMLInputElement.prototype.click = origClick;
          if (!picked) {
            reject(new Error('点了发图按钮，但页面没有唤起文件选择框 —— 它可能改成了别的上传方式'));
            return;
          }
          try {
            picked.files = dt.files;
            picked.dispatchEvent(new Event('input', { bubbles: true }));
            picked.dispatchEvent(new Event('change', { bubbles: true }));
          } catch (e3) {
            reject(new Error('把图交给文件选择框失败：' + String(e3 && e3.message)));
            return;
          }
          resolve({ dispatched: true, bytes: buf.length, via: 'picker' });
        }, 800);
      });
    }

    // 先给焦点：多数聊天输入框只处理「自己是焦点」时的粘贴。
    try { el.focus(); } catch (e) { /* 拿不到焦点也照样派发，让页面自己决定 */ }

    var ev;
    try {
      ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    } catch (e) {
      throw new Error('这个页面里造不出 ClipboardEvent：' + String(e && e.message));
    }
    el.dispatchEvent(ev);
    return { dispatched: true, bytes: buf.length };
  };

  // 发图确认框。**闲鱼粘完图不是直接就能发** —— 它会自己弹一个
  // 「确定发送以下图片吗?」，图要点了那个框上的「发送」才真的走
  // （2026-08-31 真机测出来的）。
  //
  // # 为什么按文字找，不按类名
  //
  // 这个框的类名和页面上别处一样是 CSS Modules 的构建哈希，重新构建就变。
  // 所以先按**标题文字**定位那个框，再在框里按**按钮文字**找那一下 ——
  // 和 `commit` 的「容器定位 + 文字核对」是同一套手法。
  //
  // # 没弹框不是错
  //
  // 返回 `{found:false}` 而不是抛错：这个框会不会弹，取决于闲鱼的版本和
  // 图片来源，我们没资格假定它一定在。判据在 Rust 那边（发完重读会话，
  // 最后一条必须是我们发的那张图），这里只负责「有就点掉」。
  ops.confirmImageSend = function (args) {
    var a = args || {};
    // 有选择器就按选择器（飞鸽的发图框没有标题，只有一个带 `data-qa-id`
    // 的「发送」键）。不在 = 没弹；在但不可点 = found 而未 clicked。
    if (a.selector) {
      var direct;
      try { direct = document.querySelector(a.selector); } catch (e) {
        throw new Error('发图确认键选择器不合法：' + String(e && e.message));
      }
      // **用 `trulyVisible` 而不是只看矩形** —— 见那个函数的说明：关掉之后
      // 卡在消失动画里的确认框仍然有矩形，只看矩形会去点一个幽灵并报「已点」。
      if (!trulyVisible(direct)) { return { found: false }; }
      if (direct.disabled === true || direct.getAttribute('aria-disabled') === 'true') {
        return { found: true, clicked: false, seen: shortTextsIn(direct.parentElement || direct) };
      }
      direct.click();
      return { found: true, clicked: true };
    }
    var title = String(a.title || '');
    var want = String(a.buttonText || '');
    if (title === '') { throw new Error('没有给出发图确认框的标题字样'); }
    if (want === '') { throw new Error('没有给出确认按钮的文字'); }

    var box = deepestWith(title);
    if (!box) { return { found: false }; }

    // 从标题往上找含有那个按钮的祖先。**上限 8 层**：标题和按钮同属一个
    // 弹窗，隔不了那么远。不设上限会一路走到 body，然后点中页面上别处
    // 那个同名的「发送」—— 那一下会把输入框里的东西发给买家。
    var node = box;
    var top = box;
    for (var up = 0; up < 8 && node; up++) {
      top = node;
      var btn = clickableWithText(node, want);
      if (btn) {
        btn.click();
        return { found: true, clicked: true };
      }
      node = node.parentElement;
      // 走到 body 就停。**再往上就不是这个弹窗了** —— 而页面上别处那个
      // 「发送」（输入框旁边那个）正等在那里，点中它会把输入框里的东西
      // 发给买家。
      if (node === document.body) { break; }
    }

    // 框在、按钮找不着。**这个框是模态的**，留着它后面所有操作都做不了，
    // 所以尽力按一下 Esc。按不掉也要把框里的短文字全带回去 —— 那是告诉
    // 我们「闲鱼把按钮改叫什么了」的唯一线索。
    //
    // 从**找过的最外一层**捞，不是从标题的父元素捞。第一版就是只捞父元素，
    // 结果真机上 `seen` 回来是空的：标题的父元素只是标题那一行，按钮在
    // 隔壁分支 —— 出了问题却什么线索都没带回来。
    pressEscape();
    return { found: true, clicked: false, seen: shortTextsIn(top) };
  };

  // 含有 needle 的**最深**的那个可见元素。
  //
  // 取最深的：`body` 也「含有」这段文字，从它往上找按钮等于在整个页面里
  // 找，那正是上面那条 8 层上限要防的事。
  function deepestWith(needle) {
    var all = document.body ? document.body.querySelectorAll('*') : [];
    var best = null;
    var bestKids = -1;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if ((el.textContent || '').indexOf(needle) === -1) { continue; }
      // 隐藏节点要跳过：Ant Design 这类框架关掉弹窗之后会把节点留在 DOM
      // 里，算上它们等于对着一个已经关掉的框点按钮。
      if (!el.getClientRects || el.getClientRects().length === 0) { continue; }
      var kids = el.getElementsByTagName('*').length;
      if (best === null || kids < bestKids) { best = el; bestKids = kids; }
    }
    return best;
  }

  // 一个元素「显示出来的字」，去掉全部空白。没有文字的用无障碍标签兜底。
  //
  // 不直接用 `squeeze(el.innerText)`：SVG 元素身上根本没有 `innerText`，
  // 而 `squeeze` 里是 `String(t)` —— `undefined` 会被变成字符串
  // `"undefined"`，混进诊断信息里，也可能去匹配一个真叫这个名字的按钮。
  function labelOf(el) {
    var t = squeeze(el.innerText || '');
    if (t !== '' || !el.getAttribute) { return t; }
    // 图标按钮没有文字，但常有无障碍标签。
    return squeeze(el.getAttribute('aria-label') || el.getAttribute('title') || '');
  }

  // `root` 里文字**恰好**等于 want 的那个可见元素，取最深的一个。
  //
  // 全等（去空白之后）而不是包含：包含会匹配上整个弹窗（它的 innerText 里
  // 当然有「发送」），而点弹窗本身什么都不会发生 —— 那是一次静默失败。
  //
  // **去空白这一步是这个坑第二次咬人。** `commit` 里那条注释写着
  // 2026-08-27 真机联测的教训：配置里写「发送」，页面上是「发 送」
  // （字距空格）。这支确认框的第一版没照着做，于是 2026-08-31 真机上
  // 原样重演了一遍 —— 标题认出来了，按钮死活找不着。所以两处共用同一个
  // `squeeze`，不再各写一份。
  //
  // **不限标签。** 第一版只查 `button, [role=button], a, div, span`，而
  // 那份名单是猜的：按钮是 `<p>`、`<label>`、或者某个自定义元素时全部漏掉，
  // 表现是「框在、按钮找不着」。弹窗本身很小，查 `*` 的代价可以忽略。
  function clickableWithText(root, want) {
    var w = squeeze(want);
    var cands = root.querySelectorAll('*');
    var best = null;
    var bestKids = -1;
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i];
      if (labelOf(el) !== w) { continue; }
      if (!el.getClientRects || el.getClientRects().length === 0) { continue; }
      if (el.disabled === true) { continue; }
      if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') { continue; }
      var kids = el.getElementsByTagName('*').length;
      if (best === null || kids < bestKids) { best = el; bestKids = kids; }
    }
    return best;
  }

  // `root` 里所有短的可见文字（含无障碍标签），去重。**只给诊断用。**
  function shortTextsIn(root) {
    var out = [];
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length && out.length < 24; i++) {
      var el = all[i];
      if (!el.getClientRects || el.getClientRects().length === 0) { continue; }
      var t = labelOf(el);
      if (t === '' || t.length > 10) { continue; }
      if (out.indexOf(t) === -1) { out.push(t); }
    }
    return out;
  }

  // 尽力按一下 Esc。**失败不抛** —— 它是收尾动作，调用方此刻手里已经有
  // 一个更要紧的错误要报。
  function pressEscape() {
    try {
      var down = new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true
      });
      var up = new KeyboardEvent('keyup', {
        key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true
      });
      document.dispatchEvent(down);
      document.dispatchEvent(up);
    } catch (e) { /* 按不掉就算了，上层会报出来 */ }
  }

  ops.inputValue = function (args) {
    var el = theOnly(args && args.input, '输入框');
    // 富文本输入框没有 `value`，读它显示出来的字（发完之后 Quill 会留一个
    // 空段落，innerText 是一个换行，Rust 侧按 trim 之后为空判「已清空」）。
    if (el.isContentEditable) { return { value: String(el.innerText || '') }; }
    return { value: el.value };
  };

  // 提交。**容器定位 + 文字核对** —— 发送按钮没有专属类名（实测：类全是
  // Ant Design 通用类），而那一片里还有表情、图片等别的按钮。
  ops.commit = function (args) {
    var a = args || {};
    // v58：**按回车发送**（画像 `send_with_enter`，只有拼多多开）。拼多多的发送键
    // 处理函数查 `event.isTrusted`，脚本点上去一律不理；输入框的回车处理不查。
    // 这是页面本来就有的路，我们不伪装成真人 —— 页面看得见这次回车不是真人按的。
    // 哪天它也查了，输入框不清空，Rust 侧的核对会把这次判成没发出去。
    if (a.enter) {
      var field = theOnly(a.input, '输入框');
      if (typeof field.focus === 'function') { field.focus(); }
      var ev = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
      // 页面按 `keyCode === 13` 认回车，构造参数里设不了这一项。
      try {
        Object.defineProperty(ev, 'keyCode', { get: function () { return 13; } });
        Object.defineProperty(ev, 'which', { get: function () { return 13; } });
      } catch (eKey) { /* 设不上就照原样派发，让核对去判 */ }
      field.dispatchEvent(ev);
      return { pressed: true };
    }
    // 有 `sendButton` 就直接点它（抖店的发送键是个 `<div>`，按标签扫不到）。
    // 唯一定位与 disabled 核对照旧。
    if (a.sendButton) {
      var direct = theOnly(a.sendButton, '发送按钮');
      if (direct.disabled || direct.getAttribute('aria-disabled') === 'true') {
        throw new Error('发送按钮当前不可点 —— 输入框可能是空的，或页面正在发送上一条');
      }
      direct.click();
      return { clicked: true };
    }
    var box = theOnly(a.container, '发送按钮所在的区域');
    var want = String(a.buttonText || '');
    if (want === '') { throw new Error('没有给出发送按钮的文字'); }
    var buttons = box.querySelectorAll('button');
    var hit = null;
    var seen = [];
    for (var i = 0; i < buttons.length; i++) {
      var t = (buttons[i].innerText || buttons[i].textContent || '').trim();
      seen.push(t);
      // 比较时去掉**所有**空白。Ant Design 会给只有两个汉字的按钮插一个
      // 字距空格：配置里写的是「发送」，页面上是「发 送」（2026-08-27
      // 真机联测实测）。精确等值在这里必然失败，而失败的样子是
      // 「回复已经写进输入框却发不出去」—— 最难猜的一种。
      if (squeeze(t) === squeeze(want)) {
        if (hit) {
          throw new Error('找到多个文字为「' + want + '」的按钮 —— 无法确定是哪一个');
        }
        hit = buttons[i];
      }
    }
    if (!hit) {
      throw new Error('在发送区里找不到文字为「' + want + '」的按钮（区里共 ' +
        buttons.length + ' 个按钮：' + seen.join('/') + '）—— 页面可能已改版');
    }
    if (hit.disabled || hit.getAttribute('aria-disabled') === 'true') {
      throw new Error('发送按钮当前不可点 —— 输入框可能是空的，或页面正在发送上一条');
    }
    hit.click();
    return { clicked: true };
  };

  // v58：拼多多**回车失效时的接口后备**（画像 `send_api_fallback: "pdd"`）。
  //
  // 走的是 Customer-Agent 用的那个接口 `/plateau/chat/send_message`，但从页面
  // 里发：同源、带页面自己的 cookie。2026-11-09 真机：外层 `success: true` 不够，
  // 失败时 `result.error_code` 非空（见过 40013，那次确实没发出去）；成功时手机
  // 上收到、**当前页面不显示**（页面自己发消息走 WebSocket，不收这条的推送），
  // 刷新之后才出现在历史里 —— 所以 Rust 侧发完要刷新页面再读回核对。
  //
  // 收信人取页面仓库里的当前会话，并与聊天区里消息上的 `currentuid` 核对，
  // 对不上就不发：发错人比发不出去糟得多。
  ops.pddSendText = function (args) {
    var a = args || {};
    var text = String(a.text || '');
    if (!text.trim()) { throw new Error('没有要发的字'); }
    var st = pddStore();
    if (!st) { throw new Error('读不到拼多多页面的会话数据 —— 接口后备用不了'); }
    var cur = st.currentUserInfo || {};
    var uid = cur.userInfo && cur.userInfo.uid ? String(cur.userInfo.uid) : '';
    if (!uid) { throw new Error('页面上没有选中的买家 —— 接口后备不发'); }
    var area = null;
    try { area = document.querySelector(a.chatArea || '#merchantChatPanelMain'); } catch (eA) { area = null; }
    var seen = {};
    var holders = (area || document).querySelectorAll('[currentuid]');
    for (var i = 0; i < holders.length; i++) { seen[holders[i].getAttribute('currentuid') || ''] = 1; }
    delete seen[''];
    var ids = Object.keys(seen);
    if (ids.length > 1 || (ids.length === 1 && ids[0] !== uid)) {
      throw new Error('页面数据里的当前买家（' + uid + '）与聊天区对不上（' + ids.join(',') + '）—— 正在切换，接口后备不发');
    }
    var body = {
      data: {
        cmd: 'send_message',
        request_id: Date.now(),
        message: {
          to: { role: 'user', uid: uid },
          from: { role: 'mall_cs' },
          content: text,
          msg_id: null,
          type: 0,
          is_aut: 0,
          manual_reply: 1
        }
      },
      client: 'WEB'
    };
    return window.fetch('/plateau/chat/send_message', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json;charset=UTF-8' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!j || j.success !== true) {
          throw new Error('发消息接口没接受（HTTP ' + r.status + (j && j.errorMsg ? '，' + String(j.errorMsg).slice(0, 60) : '') + '）');
        }
        var res = j.result || {};
        if (res.error_code) {
          throw new Error('发消息接口报错 ' + res.error_code + (res.error ? '：' + String(res.error).slice(0, 60) : '') + ' —— 这一条没发出去');
        }
        return { ok: true, uid: uid };
      });
    });
  };

  // 捕获到的原始响应体。**只在 Rust 显式来取时才回传**（见文件头第二条纪律）。
  ops.captured = function (args) {
    var api = args && args.api;
    if (!Object.prototype.hasOwnProperty.call(kept, api)) {
      throw new Error('还没有捕获到 ' + String(api) +
        ' —— 页面可能还没发过这个请求，或者页面刚导航过');
    }
    return kept[api];
  };

  // ---- 商品清单：快速通道 --------------------------------------------------
  //
  // # 为什么不能自己发请求去拉清单
  //
  // 闲鱼的 MTop 网关要签名（`_m_h5_tk` token + `sign` = MD5 拼串）。自己算
  // 意味着逆向算法、管 token 刷新、每次阿里轮换就挂。老工程 V3 想出的解法是：
  // **偷一份页面真的发过的请求当模板**，然后用**页面自己的 mtop 客户端**照着
  // 模板改分页参数重发 —— 签名由它自己算，我们从头到尾不知道怎么签。
  //
  // 模板里带的是**参数形状**（api 名、版本、userId 这类），不是签名本身。
  // 签名有时效，偷来也用不了几分钟；参数形状不会过期。
  //
  // # 为什么另起一套记录，不扩 KEEP
  //
  // KEEP 是常驻的白名单，它存在的意义是「我们究竟把什么留在了内存里」有一个
  // 能一眼看完的答案。把商品接口塞进去，等于全天候多留一类数据，而这件事一年
  // 只用几次。这里改成**显式布防**：Rust 说「开始留意这个片段」才开始记，
  // 有效期到了自动撤防。
  //
  // # 布防期间记的比 KEEP 多一样：请求本身
  //
  // 重放需要接口名、版本和参数，这三样都在**请求**里，不在响应里。KEEP 只留
  // 响应体，所以这里必须另记。**但仍然只回传我们要的字段** —— 响应体留在页面
  // 内存，不过 IPC（文件头第二条纪律）。

  var armed = null;      // { fragment, until } —— 同一时刻只允许一个
  var armedHits = [];    // { api, v, data, itemCount }
  var MAX_ARMED_HITS = 4;
  var ARM_TTL_MS = 180 * 1000;

  // 从 MTop 的 URL 里取出接口名与版本。
  //
  // 形如 https://h5api.m.goofish.com/h5/mtop.idle.web.xyh.item.list/1.0/?... // gate-allow: 注释里的示例，代码不使用
  // —— 接口名与版本在**路径**里，不在查询串里。取错了重放会打到一个不存在的
  // 接口上，而错误信息是网关给的一句「接口不存在」，看不出根因在我们这边。
  function mtopRouteOf(url) {
    if (typeof url !== 'string') { return null; }
    var m = /\/h5\/(mtop\.[a-z0-9_.]+)\/([0-9.]+)\//i.exec(url);
    if (!m) { return null; }
    return { api: m[1], v: m[2] };
  }

  // 请求带的业务参数。GET 在查询串的 data=，POST 在表单体的 data=。
  //
  // 两条都要认：闲鱼这几个接口两种都出现过，而只认一种的表现是「布防了却
  // 一直捕不到」—— 与「页面就是没发过」长得一模一样。
  function requestDataOf(url, body) {
    var text = null;
    try {
      var q = /[?&]data=([^&]*)/.exec(String(url));
      if (q) { text = decodeURIComponent(q[1]); }
    } catch (e) { /* 解码失败，往下试请求体 */ }
    if (text === null && typeof body === 'string') {
      try {
        var b = /(?:^|&)data=([^&]*)/.exec(body);
        if (b) { text = decodeURIComponent(b[1]); }
      } catch (e) { /* 同上 */ }
    }
    if (text === null) { return null; }
    try {
      var parsed = JSON.parse(text);
      return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : null;
    } catch (e) { return null; }
  }

  // 递归找商品数组。**判据是「有没有那几个键」，不是「在第几层」** ——
  // 与 findAll 同一条理由：写死 JSON 路径等于把一次无声的失效埋进代码。
  var ITEM_KEYS = ['itemId', 'item_id', 'itemDO', 'cardData'];

  function looksLikeItem(row) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) { return false; }
    for (var i = 0; i < ITEM_KEYS.length; i++) {
      if (Object.prototype.hasOwnProperty.call(row, ITEM_KEYS[i])) { return true; }
    }
    return false;
  }

  function findItems(value, depth) {
    if (depth > 10 || value === null || typeof value !== 'object') { return []; }
    if (Array.isArray(value)) {
      var rows = [];
      for (var i = 0; i < value.length; i++) {
        if (looksLikeItem(value[i])) { rows.push(value[i]); }
      }
      if (rows.length > 0) { return rows; }
      for (var j = 0; j < value.length; j++) {
        var found = findItems(value[j], depth + 1);
        if (found.length > 0) { return found; }
      }
      return [];
    }
    var keys = Object.keys(value);
    for (var k = 0; k < keys.length; k++) {
      var hit = findItems(value[keys[k]], depth + 1);
      if (hit.length > 0) { return hit; }
    }
    return [];
  }

  // 这个 URL 归不归布防管。**在钩子里先问一次**，是为了让「没布防」这条
  // 路上一个字节都不多留 —— 常态是没布防。
  function armedMatches(url) {
    if (armed === null || typeof url !== 'string') { return false; }
    if (Date.now() > armed.until) { armed = null; armedHits = []; return false; }
    return url.indexOf(armed.fragment) !== -1;
  }

  function noteArmed(url, body, text) {
    if (armed === null) { return; }
    if (Date.now() > armed.until) { armed = null; armedHits = []; return; }
    if (String(url).indexOf(armed.fragment) === -1) { return; }
    if (typeof text !== 'string' || text.length > MAX_BODY) { return; }
    var route = mtopRouteOf(url);
    if (!route) { return; }
    var data = requestDataOf(url, body);
    if (data === null) { return; }
    var count = 0;
    try { count = findItems(JSON.parse(text), 0).length; } catch (e) { count = 0; }
    // 只留计数，**不留响应体** —— 首屏那一份重放时会重新拿到，留着只是多一份
    // 商品数据常驻在内存里。
    armedHits.push({
      api: route.api, v: route.v, data: data, itemCount: count,
      // **点「在售」之前抓到的那一份带的是「综合」的筛选条件。**
      // 分不出前后，就会拿它去重放，把已售出的商品一起收进来。
      at: Date.now()
    });
    if (armedHits.length > MAX_ARMED_HITS) { armedHits.shift(); }
  }

  // 按**文字**找一个筛选标签（「在售1」「已售出5」这种）。
  //
  // # 为什么按文字而不按选择器
  //
  // 这三个标签的类名是 CSS Modules 哈希，闲鱼改一次版就全变；而「在售」这
  // 两个字是给人看的，不会随构建变。选择器写进配置也行，但那要求有人在真机
  // 上抄一遍 —— 而这条路上的选择器至今一条都没验证过。
  //
  // # 「最紧」的那个才是标签本身
  //
  // 只有一个子节点的祖先容器，innerText 与标签一样。取后代最少的那个。
  // 点深层的 span 没问题：click 事件会冒泡到真正挂处理函数的那一层。
  function findTabByText(needle) {
    if (typeof needle !== 'string' || needle === '') { return null; }
    var nodes = document.querySelectorAll(
      'button, a, div, span, li, [role="tab"], [role="button"]'
    );
    var best = null;
    for (var i = 0; i < nodes.length; i++) {
      var t = (nodes[i].innerText || nodes[i].textContent || '').trim();
      if (t.indexOf(needle) !== 0) { continue; }
      // 标签后面只允许跟数字（「在售1」）。「在售中的宝贝很多」这类正文
      // 不能算 —— 点它什么都不会发生，而我们会以为筛选生效了。
      var rest = t.slice(needle.length).trim();
      if (rest !== '' && !/^[0-9]+$/.test(rest)) { continue; }
      var kids = nodes[i].querySelectorAll('*').length;
      if (best === null || kids < best.kids) {
        best = {
          el: nodes[i],
          kids: kids,
          text: t,
          count: rest === '' ? null : Number(rest)
        };
      }
    }
    return best;
  }

  // 点一下「在售」。返回点没点到、以及三个标签各自的条数。
  function clickOnSaleTab(onSaleText, soldText) {
    var onSale = findTabByText(onSaleText);
    var sold = findTabByText(soldText);
    var info = {
      wanted: onSaleText,
      found: onSale !== null,
      clicked: false,
      clickError: '',
      onSaleCount: onSale ? onSale.count : null,
      soldCount: sold ? sold.count : null
    };
    if (onSale) {
      try {
        onSale.el.click();
        info.clicked = true;
      } catch (e) {
        info.clickError = String((e && e.message) || e);
      }
    }
    return info;
  }

  // 布防。幂等：同一个片段重复调只是续期。
  ops.armCapture = function (args) {
    var a = args || {};
    var fragment = String(a.fragment || '');
    if (fragment === '') { throw new Error('没有给出要留意的接口片段'); }
    if (armed === null || armed.fragment !== fragment) { armedHits = []; }
    armed = { fragment: fragment, until: Date.now() + ARM_TTL_MS };
    return { fragment: fragment, hits: armedHits.length };
  };

  ops.disarmCapture = function () {
    armed = null;
    armedHits = [];
    return { disarmed: true };
  };

  // 等一份真实请求。等不到就返回 null —— **不抛错**：等不到是一种常态
  // （页面刚打开还没发过、或平台改版了），由 Rust 决定降级到保底通道。
  // 抛错会让「该降级了」变成「出故障了」，而两者对用户的意思完全不同。
  // 布防抓包 —— **短调用**，装完就返回。
  //
  // # 为什么不再是「调一次，等它抓到再返回」
  //
  // 那一次调用要干完：等筛选标签出现（最多 6 秒）→ 点「在售」→ 等页面发请求
  // （最多 8 秒）。**加起来能跨 14 秒**，而任何跨越导航的调用都会被作废 ——
  // 偏偏这条路上导航特别多：没抓到时我们自己还会刷新页面重来一次。
  //
  // 现在：装钩子、挂观察者等标签，立刻返回。之后由页面自己推进，抓到了推一条
  // 事件上去。导航把这一切冲掉时，Rust 那边会重新布防一次。
  //
  // # 先点「在售」再等请求，顺序是这一步的全部要点
  //
  // 闲鱼个人主页的三个筛选切换时**地址栏不变**，进页面默认停在「综合」。
  // 首屏那个清单请求带的是「综合」的条件 —— 拿它当模板重放，已经卖掉的商品
  // 会一起进知识库。而那件事在界面上看不出来。
  //
  // 点一下「在售」会让页面**自己**发一次带正确筛选条件的请求，我们抓那一份。
  var listCapture = null;

  function stopListCapture() {
    if (!listCapture) { return; }
    if (listCapture.ob) { try { listCapture.ob.disconnect(); } catch (e) { /* 没了 */ } }
    if (listCapture.timer) { stopEvery(listCapture.timer); }
    listCapture = null;
  }

  ops.armListCapture = function (args) {
    var a = args || {};
    var name = String(a.name || '');
    if (name === '') { throw new Error('armListCapture 要一个名字'); }
    var onSaleText = String(a.onSaleText || '');
    var soldText = String(a.soldText || '');

    stopListCapture();
    ops.armCapture({ fragment: a.fragment });

    var st = { clickedAt: 0, tab: null, ob: null, timer: null };
    listCapture = st;

    function clickNow() {
      // **点之前清空已有记录。** 首屏那一份带的是「综合」的筛选条件。
      armedHits = [];
      st.clickedAt = Date.now();
      st.tab = clickOnSaleTab(onSaleText, soldText);
    }

    function tick() {
      if (listCapture !== st) { return; }
      // 还没点过：等标签出现（没配标签文字就当作立刻可点）
      if (st.clickedAt === 0) {
        if (onSaleText === '' || findTabByText(onSaleText) !== null) { clickNow(); }
        return;
      }
      // 点过了：等点击**之后**落下来的那一份
      for (var i = armedHits.length - 1; i >= 0; i--) {
        if (armedHits[i].at >= st.clickedAt) {
          var hit = armedHits[i];
          var tab = st.tab;
          stopListCapture();
          post({
            kind: 'event', name: name,
            data: { hit: hit, tab: tab, postClick: true }
          });
          return;
        }
      }
    }

    try {
      st.ob = new MutationObserver(tick);
      st.ob.observe(document.documentElement || document.body, {
        childList: true, subtree: true
      });
    } catch (e) {
      // 文档还没成形。下面那个定时器照样能接住。
    }
    // **这个定时器在页面里**，不产生任何跨进程调用 —— 与「Rust 每秒问页面
    // 一次」不是一回事。它随文档一起消失，而那正是它该有的生命周期。
    st.timer = every(tick, 250);
    tick();
    return { armed: true };
  };

  // 布防了却始终没抓到时，Rust 会来收摊。
  ops.disarmListCapture = function () {
    stopListCapture();
    ops.disarmCapture();
    return { ok: true };
  };

  // 抓不到的那一刻，把标签上的条数取回去 —— 它是对账用的外部真相。
  //
  // **只读，不点。** 这里一度直接复用了 `clickOnSaleTab`，于是一个叫
  // 「readOnly」的操作会点用户页面上的按钮 —— 名字撒谎的函数最难查。
  ops.readTabCounts = function (args) {
    var a = args || {};
    var onSale = findTabByText(String(a.onSaleText || ''));
    var sold = findTabByText(String(a.soldText || ''));
    return {
      wanted: String(a.onSaleText || ''),
      found: onSale !== null,
      clicked: false,
      clickError: '',
      onSaleCount: onSale ? onSale.count : null,
      soldCount: sold ? sold.count : null
    };
  };

  // 页面自己的 mtop 客户端。**这才是签名能力的来源。**
  function mtopClient() {
    var c = (window.lib && window.lib.mtop) || window.mtop || null;
    return (c && typeof c.request === 'function') ? c : null;
  }

  // 商品摘要。**只取挑选界面要用的那几个字段**，不回传整个商品对象 ——
  // 那里面有买家出价、浏览量之类与我们无关的东西，而 IPC 那头是会进日志的。
  //
  // # 真实形状（2026-08-27 在真机上抓的）
  //
  //   { cardType: 1003, cardData: {
  //       id: '1076790207919', title: '…', itemStatus: 0,
  //       priceInfo:    { preText: '¥', price: '9.99万' },
  //       picInfo:      { picUrl: '…/O1CN….jpg' },   // 别名就藏在这段路径里
  //       detailParams: { itemId: '1076790207919', picUrl: '…' } } }
  //
  // 这一版之前 price / thumb / itemId **三个全落空** —— 它们被写成
  // `d.price` / `d.picUrl` / `d.itemId`，而真实数据里价格在 `priceInfo.price`、
  // 图在 `picInfo.picUrl`、id 叫 `id`。
  //
  // 落空的后果不是「少显示一个价格」：
  //
  // - `itemId` 空 → 学习那一步拼不出详情页地址，**每一件都退化成只有标题**
  //   （`ItemOutcome::BriefOnly`），而界面上看起来是「学完了 30 件」
  // - `thumb` 空 → 抠不出 `O1CN…` 那段稳定别名，而闲鱼卖家随时改标题，
  //   只有它不变 —— 于是同一件商品每次扫描都显示成「新的」，用户一次次
  //   为它重复付费
  //
  // 所以这里**按真实层级取，同时留着几个别名**：改版把字段挪走时，留着的
  // 别名还有一半机会接住；全写死则是直接静默落空。
  function briefOf(row) {
    var d = (row && typeof row.cardData === 'object' && row.cardData) ||
            (row && typeof row.itemDO === 'object' && row.itemDO) || row || {};
    function pick(obj, keys) {
      if (!obj || typeof obj !== 'object') { return ''; }
      for (var i = 0; i < keys.length; i++) {
        var v = obj[keys[i]];
        if (typeof v === 'string' && v !== '') { return v; }
        if (typeof v === 'number') { return String(v); }
      }
      return '';
    }
    var priceInfo = (d.priceInfo && typeof d.priceInfo === 'object') ? d.priceInfo : {};
    var picInfo = (d.picInfo && typeof d.picInfo === 'object') ? d.picInfo : {};
    var detailParams =
      (d.detailParams && typeof d.detailParams === 'object') ? d.detailParams : {};

    var title = pick(d, ['title', 'itemTitle', 'name', 'subject']);
    // 「¥」和「9.99万」是分开的两个字段，拼起来才是人看的那个价格。
    var price = pick(priceInfo, ['price', 'priceText', 'soldPrice']);
    if (price !== '') {
      price = pick(priceInfo, ['preText']) + price;
    } else {
      price = pick(d, ['price', 'soldPrice', 'priceText', 'reservePrice']);
    }
    var thumb = pick(picInfo, ['picUrl', 'imageUrl']) ||
                pick(detailParams, ['picUrl', 'imageUrl']) ||
                pick(d, ['picUrl', 'imageUrl', 'mainPic', 'image']);
    // **`id` 在前**：真实数据里它就叫 `id`，`itemId` 只在 `detailParams` 里。
    var itemId = pick(d, ['id', 'itemId', 'item_id']) ||
                 pick(detailParams, ['itemId', 'id']);
    // `detailUrl` 是 `fleamarket://` 的 app 协议，网页打不开 —— 详情页地址由
    // Rust 侧用 `item_url` 前缀 + id 拼。这里只把 id 带出去。
    var status = (typeof d.itemStatus === 'number') ? d.itemStatus : null;
    return {
      title: title, price: price, thumb: thumb, itemId: itemId,
      itemStatus: status, images: imagesOf(detailParams, picInfo, thumb)
    };
  }

  // 这件商品的全部主图。
  //
  // # 为什么在这里取，而不是到详情页上读
  //
  // 详情页的主图是**轮播**，DOM 里一次只有当前那一张 —— 真机上跑选择器就是
  // 拿到 1 张。而尺码表说不准是第几张，只拿第一张等于多模态多半看不到它。
  //
  // 清单接口的 `detailParams.imageInfos` 里是全部，一次拿全，还省掉一次
  // 详情页加载（那一次要连带加载页面下半部二十张别的卖家的推荐图）。
  //
  // 它是个 **JSON 字符串**，不是数组 —— 解不开就返回空，让详情页那条路兜着。
  function imagesOf(detailParams, picInfo, thumb) {
    var out = [];
    function push(u) {
      if (typeof u !== 'string' || u === '') { return; }
      for (var i = 0; i < out.length; i++) { if (out[i] === u) { return; } }
      out.push(u);
    }
    var raw = detailParams && detailParams.imageInfos;
    if (typeof raw === 'string' && raw !== '') {
      try {
        var arr = JSON.parse(raw);
        if (Object.prototype.toString.call(arr) === '[object Array]') {
          // `major` 的排前面：多模态那边有张数上限（`llm::vision::MAX_IMAGES`），
          // 排在后面的会被裁掉，而主图比细节图更值得留。
          var major = [];
          var rest = [];
          for (var i = 0; i < arr.length; i++) {
            var it = arr[i];
            if (!it || typeof it !== 'object') { continue; }
            var u = typeof it.url === 'string' ? it.url : '';
            if (u === '') { continue; }
            (it.major === true ? major : rest).push(u);
          }
          major.concat(rest).forEach(push);
        }
      } catch (e) {
        // 解不开就算了 —— 下面还有 picInfo 和缩略图兜着。
      }
    }
    push(picInfo && picInfo.picUrl);
    push(detailParams && detailParams.picUrl);
    push(thumb);
    return out;
  }

  // 照模板重放翻页。**串行**，每页之间留间隔 —— 并发翻页是最容易撞风控的
  // 形状，而撞了之后代价是整个账号被要求验证，不只是这次录入失败。
  ops.replayList = function (args) {
    var a = args || {};
    var client = mtopClient();
    if (!client) {
      throw new Error('页面里没有可用的 mtop 客户端 —— 拿不到它的签名能力，' +
        '快速通道用不了（页面可能还没加载完，或已改版）');
    }
    var api = String(a.api || '');
    var v = String(a.v || '1.0');
    var base = (a.data && typeof a.data === 'object') ? a.data : {};
    if (api === '') { throw new Error('没有给出要重放的接口名'); }

    var pageParam = String(a.pageParam || 'pageNumber');
    var maxPages = Number(a.maxPages) > 0 ? Math.min(Number(a.maxPages), 100) : 50;
    var pageDelay = Number(a.pageDelay) >= 0 ? Number(a.pageDelay) : 800;

    var items = [];
    var seen = {};
    var pages = 0;
    // `itemStatus` 各个取值各有几件。**只统计不过滤** —— 真机上只见过在售的
    // 那个值（0），拿一个样本去推断「别的值都是已售出」，然后据此丢掉商品，
    // 是在用猜测做不可见的删除。这个分布会带回 Rust 记进日志，等看清楚了
    // 再决定要不要真的按它过滤。
    var statusCounts = {};

    // 固定间隔本身就是个指纹 —— 真人不会每次都恰好隔 800ms。抖 ±35%。
    function sleepJitter(ms) {
      var d = Math.round(ms * (0.65 + Math.random() * 0.7));
      return new Promise(function (r) { later(r, d); });
    }

    function onePage(n) {
      var data = {};
      for (var k in base) {
        if (Object.prototype.hasOwnProperty.call(base, k)) { data[k] = base[k]; }
      }
      data[pageParam] = n;
      return client.request({
        api: api, v: v, data: data,
        type: 'GET', dataType: 'json', timeout: 15000
      });
    }

    function step(n) {
      if (n > maxPages) { return Promise.resolve(); }
      return onePage(n).then(function (res) {
        pages += 1;
        var rows = findItems(res, 0);
        var fresh = 0;
        for (var i = 0; i < rows.length; i++) {
          var b = briefOf(rows[i]);
          // 没标题的存不进去 —— 标题是知识库里认商品的主别名，空标题的商品
          // 建出来之后谁也匹配不上它。
          if (b.title === '') { continue; }
          var key = b.itemId !== '' ? b.itemId : b.title;
          if (Object.prototype.hasOwnProperty.call(seen, key)) { continue; }
          seen[key] = 1;
          var sk = b.itemStatus === null ? 'null' : String(b.itemStatus);
          statusCounts[sk] = (statusCounts[sk] || 0) + 1;
          items.push(b);
          fresh += 1;
        }
        // 这一页一个新的都没有 = 到底了。**按「新增」而不是「返回条数」判**：
        // 有些接口翻到底之后会一直回同一页，按条数判会永远翻不完。
        if (fresh === 0) { return; }
        return sleepJitter(pageDelay).then(function () { return step(n + 1); });
      });
    }

    return step(1).then(function () {
      return { items: items, pages: pages, statusCounts: statusCounts };
    });
  };

  // 直接问出「在售」那个分组的 id。
  //
  // # 这条路比「点一下再抓」稳
  //
  // 筛选靠 `groupId`（真机上 综合 50907172 / 在售 50907173 / 已售出 50907174），
  // 而 `groupId` 是每个账号各自的，写死不得。原先只能靠「点一下『在售』，
  // 希望页面为此发一次请求，抓那一份」—— 依赖时序，也依赖那个标签还在原地。
  //
  // 而把随便哪一份请求的 `needGroupInfo` 打开，响应里就带着完整的分组清单
  // （id + 名字）。于是无论手上抓到的是哪个分组的模板，都能自己换成「在售」的。
  //
  // 失败**不抛错**：拿不到清单就退回原来那套（用抓到的模板 + 名字核对）。
  ops.resolveItemGroup = function (args) {
    var a = args || {};
    var client = mtopClient();
    if (!client) {
      throw new Error('页面里没有可用的 mtop 客户端 —— 查不了分组');
    }
    var api = String(a.api || '');
    var v = String(a.v || '1.0');
    var want = String(a.wantName || '').trim();
    var base = (a.data && typeof a.data === 'object') ? a.data : {};
    if (api === '') { throw new Error('没有给出接口名'); }

    var data = {};
    for (var k in base) {
      if (Object.prototype.hasOwnProperty.call(base, k)) { data[k] = base[k]; }
    }
    data.needGroupInfo = true;
    data.pageNumber = 1;

    return client.request({
      api: api, v: v, data: data,
      type: 'GET', dataType: 'json', timeout: 15000
    }).then(function (res) {
      var groups = [];
      (function walk(v2, d) {
        if (d > 7 || v2 === null || typeof v2 !== 'object') { return; }
        if (Array.isArray(v2)) {
          for (var i = 0; i < v2.length; i++) {
            var x = v2[i];
            if (x && typeof x === 'object' &&
                Object.prototype.hasOwnProperty.call(x, 'groupId') &&
                Object.prototype.hasOwnProperty.call(x, 'groupName')) {
              groups.push({ groupId: x.groupId, groupName: String(x.groupName) });
            }
            walk(x, d + 1);
          }
          return;
        }
        var ks = Object.keys(v2);
        for (var j = 0; j < ks.length; j++) { walk(v2[ks[j]], d + 1); }
      })(res, 0);

      var matched = null;
      for (var m = 0; m < groups.length; m++) {
        if (groups[m].groupName.trim() === want) { matched = groups[m]; break; }
      }
      // **把看到的分组名一起带回去。** 没找到「在售」时，Rust 那边要能说出
      // 「我看到的是 综合 / 已售出」—— 一句「没找到」用户无从判断是改版了
      // 还是这个号本来就没有那个分组。
      return { groups: groups, matched: matched };
    });
  };

  // ---- 商品清单：保底通道 --------------------------------------------------
  //
  // 快速通道走不通时的那条路：滚过卖家自己的商品列表页，逐张卡片读 DOM。
  // 慢，但它不依赖任何接口 —— 平台改接口拦不住它，只有改 DOM 才拦得住，
  // 而 DOM 改了还有兜底选择器。
  //
  // # 两级选择器：先试精确的，不中再试兜底的
  //
  // **不写成 `"精确, 兜底"` 一条选择器列表**：CSS 选择器列表里任何一段语法
  // 非法，整条都会抛错 —— 那样一个写错字的精确选择器会把它自己的兜底一起
  // 带走，而兜底存在的全部意义就是在精确那条失效时接住。
  //
  // # 虚拟滚动
  //
  // 闲鱼个人主页是虚拟列表，**DOM 里只有可见的那几张卡片**。会话列表那边我们
  // 是绕过去的（改读 session.sync 接口），这里绕不过去，只能边滚边收。
  //
  // 收工判据是「连续 N 轮没有新卡片」而不是「滚到底了」：`scrollHeight` 在
  // 虚拟列表里是估算值，会随着渲染不断变，拿它当终点会提前收工或者永远不停。

  // 两级里挑一条能用的。两级都不中就返回空数组 —— **不抛错**：一张卡片上
  // 没有价格是正常的，为此中断整轮扫描不值得。
  function queryTwoLevel(root, tl) {
    if (!tl || typeof tl !== 'object') { return []; }
    var levels = [tl.exact, tl.fallback];
    for (var i = 0; i < levels.length; i++) {
      var q = levels[i];
      if (typeof q !== 'string' || q === '') { continue; }
      try {
        var found = root.querySelectorAll(q);
        if (found.length > 0) { return Array.prototype.slice.call(found); }
      } catch (e) {
        // 这一级语法写错了。**继续试下一级** —— 正是两级存在的理由。
      }
    }
    return [];
  }

  function textOf(root, tl) {
    var hit = queryTwoLevel(root, tl);
    if (hit.length === 0) { return ''; }
    return (hit[0].innerText || hit[0].textContent || '').trim();
  }

  // 标题：连续空白压成一个空格。
  // **不能全删** —— 「匿名科创 领航者 飞控 电赛」删光空格就变成另一个字符串，
  // 而标题是知识库里认商品的主别名，改了它就再也匹配不上真实会话里的商品。
  function tidyTitle(s) {
    return String(s).replace(/\s+/g, ' ').trim();
  }

  // 价格：空白全删。
  //
  // 闲鱼把价格拆成三个 span（「¥」「9」「.99万」），innerText 会在它们之间
  // 塞换行 —— 直接用就是 `¥\n9\n.99万`。而快速通道那条路拼出来的是
  // `¥9.99万`，**两条通道给出不同形状的同一个价格**，是将来对不上账的种子。
  function tidyPrice(s) {
    return String(s).replace(/\s+/g, '');
  }

  // 商品 id 藏在卡片的 href 里（`.../item?id=123456`）。去重与取详情都靠它。
  function itemIdOf(href) {
    if (typeof href !== 'string') { return ''; }
    var m = /[?&]id=([0-9]+)/.exec(href);
    return m ? m[1] : '';
  }

  ops.scanProductCards = function (args) {
    var a = args || {};
    var sel = a.selectors || {};
    // **先点「在售」。** 这条路读的是 DOM，而 DOM 里是哪一批取决于当前筛选；
    // 不点就读，读到的是「综合」——已经卖掉的商品会一起进来。
    var tab = clickOnSaleTab(String(a.onSaleText || ''), String(a.soldText || ''));
    // 卡片上带这些字样的当成已售出/已下架跳过。**双重保险**：万一点击没生效
    // （类名变了、标签挪走了），这一层还能拦住大部分。
    var soldNeedles = Array.isArray(a.soldNeedles) ? a.soldNeedles : [];
    var skippedSold = 0;
    var maxCards = Number(a.maxCards) > 0 ? Math.min(Number(a.maxCards), 500) : 200;
    var idleRounds = Number(a.idleRounds) > 0 ? Number(a.idleRounds) : 5;
    var settleMs = Number(a.settleMs) >= 0 ? Number(a.settleMs) : 400;
    var maxRounds = Number(a.maxRounds) > 0 ? Number(a.maxRounds) : 120;

    var items = [];
    var seen = {};
    var idle = 0;
    var rounds = 0;
    var capped = false;

    function sleep(ms) {
      return new Promise(function (r) { later(r, ms); });
    }

    // 这张卡片是已经卖掉的吗。**按文字判**：角标的类名会随改版变，
    // 「已售出」这三个字是给人看的。
    function looksSold(card) {
      if (soldNeedles.length === 0) { return false; }
      var t = (card.innerText || card.textContent || '');
      for (var i = 0; i < soldNeedles.length; i++) {
        var n = soldNeedles[i];
        if (typeof n === 'string' && n !== '' && t.indexOf(n) !== -1) { return true; }
      }
      return false;
    }

    function harvest() {
      var cards = queryTwoLevel(document, sel.card);
      var fresh = 0;
      for (var i = 0; i < cards.length; i++) {
        if (items.length >= maxCards) { capped = true; break; }
        var card = cards[i];
        if (looksSold(card)) { skippedSold += 1; continue; }
        var href = card.getAttribute ? (card.getAttribute('href') || '') : '';
        var title = tidyTitle(textOf(card, sel.cardTitle));
        // 没标题的存不进去 —— 标题是知识库里认商品的主别名。
        if (title === '') { continue; }
        var itemId = itemIdOf(href);
        var key = itemId !== '' ? itemId : title;
        if (Object.prototype.hasOwnProperty.call(seen, key)) { continue; }
        seen[key] = 1;
        var imgs = queryTwoLevel(card, sel.cardThumb);
        items.push({
          title: title,
          itemId: itemId,
          price: tidyPrice(textOf(card, sel.cardPrice)),
          thumb: imgs.length ? (imgs[0].getAttribute('src') || '') : ''
        });
        fresh += 1;
      }
      return fresh;
    }

    function step() {
      rounds += 1;
      var fresh = harvest();
      if (fresh > 0) { idle = 0; } else { idle += 1; }
      if (capped || idle >= idleRounds || rounds >= maxRounds) {
        return Promise.resolve();
      }
      // 滚一屏。**用 window 而不是某个容器** —— 容器选择器又是一条会失效的
      // 东西，而滚窗口对虚拟列表同样有效（它监听的是滚动事件，不是谁滚的）。
      try { window.scrollBy(0, Math.max(200, window.innerHeight - 100)); } catch (e) { /* 忽略 */ }
      return sleep(settleMs).then(step);
    }

    return step().then(function () {
      return {
        items: items, rounds: rounds, capped: capped,
        tab: tab, skippedSold: skippedSold
      };
    });
  };

  // 页面此刻的会话状态。**只回事实，不下判断** —— 「这算不算要重新登录」
  // 由调用方决定：同一份事实，采集那条路要停下队列，接待那条路只是少显示
  // 一个店铺名。
  //
  // # 为什么必须有这么一条
  //
  // 闲鱼的 mtop 客户端里挂着 `loginRequest` 与 `antiCreepRequest` 两个中间件
  // （`Object.keys(lib.mtop)` 上就摆着）。响应一旦是「要登录」或「要过验证」，
  // 请求就被转进那条**要人操作**的流程 —— promise 永远不落地，最后由 mtop
  // 自己的定时器报成 `{"ret":["TIMEOUT::接口超时"],"retJson":-1}`。
  //
  // **那句话是假的。** 不是网络慢、不是平台挂了，是「该有人来点一下了」，
  // 而那个页面还藏着。2026-09-10 真机验证：同一个接口在登录着的浏览器里
  // 430ms 就回来（`richTextDesc` 1836 字），在没登录的 profile 里则原样复现
  // 那句「接口超时」—— 带不带 `sessionOption: AutoLoginOnly` 都一样。
  //
  // 于是失败之后必须**再问一句页面**，否则我们连「是没登录还是真出错了」
  // 都分不出来，只能把那句假话端给商家。
  // 一个 cookie 的原值（不解码，解码在 Rust 侧）。名字由画像给，与 `sessionState`
  // 同一个理由：「这个平台用哪个 cookie」是平台的事实，这个 op 与平台无关。
  // 读不到 httpOnly 的 —— 那种 cookie 填进画像也只会一直是 `found: false`。
  ops.cookieValue = function (args) {
    var name = String((args || {}).name || '');
    var out = { name: name, found: false, value: '' };
    if (name === '') { return out; }
    var parts = String(document.cookie || '').split(';');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i];
      var eq = kv.indexOf('=');
      if (eq < 0) { continue; }
      if (kv.slice(0, eq).replace(/^\s+|\s+$/g, '') !== name) { continue; }
      out.found = true;
      out.value = kv.slice(eq + 1).replace(/^\s+|\s+$/g, '');
      break;
    }
    return out;
  };

  ops.sessionState = function (args) {
    var a = args || {};
    // Cookie 名由画像给。**不写死在这里**：它是「这个平台长什么样」的事实，
    // 而这个 op 本身与平台无关。
    var name = String(a.cookie || '');
    var out = {
      href: location.href,
      cookie: name,
      // 画像没给 cookie 名 = 这个平台没配，`loggedIn` 不作数。**分成两个
      // 字段**：一个布尔没法表达「没检查过」，而把「没检查」当成「没登录」
      // 会让调用方去劝一个已经登录的人再登录一次。
      checked: name !== '',
      loggedIn: false,
      needles: [],
      dialogText: ''
    };
    if (name !== '') {
      out.loggedIn = hasCookie(name);
    }
    var needles = a.needles;
    if (Object.prototype.toString.call(needles) === '[object Array]') {
      var hay = '';
      try { hay = (document.body && document.body.innerText) || ''; } catch (e) { hay = ''; }
      // 整页文字可能很长（详情页下面挂着一整片推荐 feed）。截一段就够判断，
      // 而不截会把一大坨文本搬来搬去。
      hay = hay.slice(0, 20000);
      // 地址也算进去：验证码页可能整页换到别的域（小红书跳
      // `www.xiaohongshu.com/web-login/captcha`），那页文字长什么样没见过，
      // 地址片段却是确定的。导航不拦、桥会重新装上，所以这里读得到。
      var href = '';
      try { href = String(location.href || ''); } catch (e3) { href = ''; }
      hay = href + '\n' + hay;
      for (var i = 0; i < needles.length && out.needles.length < 8; i++) {
        var n = String(needles[i] || '');
        if (n !== '' && hay.indexOf(n) !== -1) { out.needles.push(n); }
      }
      // **验证框常常不在这份文档里。** 阿里系（闲鱼、淘宝）的滑块是 baxia 弹出的
      // 一个 iframe（`#baxia-dialog-content`，src 形如 `…/_____tmd_____/punish?
      // x5secdata=…`），顶层 innerText 里只有一个「X」—— 2026-09-12 真机上商家
      // 正对着滑块，这里却回了 needles:[]，于是那次失败只能说成「接口超时」。
      // 老工程 `xianyu_shop.js` 的 `verificationVisible()` 就是看 iframe 的 src。
      // 命中且**看得见**（0×0 的是收起来的壳）才算；登录框（passport / mini_login）
      // 不在这个名单里，那是「没登录」，由 cookie 那条判。
      var frames = [];
      try { frames = document.querySelectorAll('iframe'); } catch (e4) { frames = []; }
      for (var fi = 0; fi < frames.length && out.needles.length < 8; fi++) {
        var fsrc = '';
        try { fsrc = String(frames[fi].getAttribute('src') || ''); } catch (e5) { fsrc = ''; }
        if (!/_____tmd_____|punish|baxia|captcha|x5secdata/i.test(fsrc)) { continue; }
        var frect = null;
        try { frect = frames[fi].getBoundingClientRect(); } catch (e6) { frect = null; }
        if (!frect || frect.width < 20 || frect.height < 20) { continue; }
        var fhost = fsrc.replace(/^https?:\/\//, '').split('/')[0];
        out.needles.push('验证滑块' + (fhost ? '（' + fhost + '）' : ''));
        break;
      }
    }
    var roots = String(a.dialogRoots || '');
    if (roots !== '') {
      var els = [];
      try { els = document.querySelectorAll(roots); } catch (e) { els = []; }
      for (var j = 0; j < els.length && out.dialogText.length < 200; j++) {
        if (!trulyVisible(els[j])) { continue; }
        var t = '';
        try { t = (els[j].innerText || '').replace(/\s+/g, ' ').trim(); } catch (e2) { t = ''; }
        if (t === '') { continue; }
        out.dialogText += (out.dialogText === '' ? '' : ' ｜ ') + t.slice(0, 100);
      }
    }
    return out;
  };

  // 商品详情 —— **走接口，不打开详情页**。
  //
  // # 为什么值得单独走一条
  //
  // 打开一个详情页不只是「加载一个页面」：闲鱼详情页下半部挂着一整片推荐
  // 商品（`mtop.taobao.idle.item.web.recommend.list`，二十张别的卖家的图）。
  // 学 30 件商品就是 30 次这样的整页加载 —— 而换成接口是 30 次调用。
  //
  // 顺手补上了一直缺的那块：**卖家写的描述**（`richTextDesc`）。闲鱼上这段
  // 正文才是最有价值的东西，而此前我们只读属性和图，属性多数个人卖家压根
  // 没填 —— 于是「学完了」这件事很可能什么都没学到。
  //
  // 失败**抛错**（不像清单那条路那样判降级）：调用方接住之后会退回「打开
  // 详情页读 DOM」，那条路仍然在。
  // 页面自己的埋点参数（照老工程 `trackingQueries`）：`spm_cnt` 由页面 meta 与
  // body 的 data-spm 拼出（个人页是 `a21ybx.personal.0.0`），真页面每个 mtop
  // 请求都带着它。
  function xyTracking() {
    var page = 'a21ybx', body = 'personal', pre = '';
    try { var meta = document.querySelector('meta[name="data-spm"]'); if (meta && meta.getAttribute('content')) { page = meta.getAttribute('content'); } } catch (e1) {}
    try { if (document.body && document.body.getAttribute('data-spm')) { body = document.body.getAttribute('data-spm'); } } catch (e2) {}
    try { var mm = /[?&]spm=([^&]*)/.exec(location.search || ''); pre = mm ? decodeURIComponent(mm[1]) : ''; } catch (e3) { pre = ''; }
    var q = { spm_cnt: page + '.' + body + '.0.0' };
    if (pre !== '') {
      q.spm_pre = pre;
      var parts = pre.split('.');
      if (parts.length === 5) { q.log_id = parts[4]; }
    }
    return q;
  }

  ops.fetchItemDetail = function (args) {
    var a = args || {};
    var client = mtopClient();
    if (!client) {
      throw new Error('页面里没有可用的 mtop 客户端 —— 详情接口调不了');
    }
    var itemId = String(a.itemId || '');
    if (itemId === '') { throw new Error('没有给出商品 id'); }

    // **照真页面的形状发。** 2026-09-13 真机抓 `/item` 页自己的 idle.pc.detail：
    // `type=originaljson`（即 POST）、`appKey=34839810`、`accountSite=xianyu`、
    // `sessionOption=AutoLoginOnly`、`timeout=20000`、`spm_cnt`。此前这里是
    // 裸 GET、什么都不带 —— 全站唯一一条长得不一样的请求。这次被滑块拦下是不是
    // 因为它说不准（同一天调试 Chrome 光开 /item 页也被拦，那是账号/环境级的），
    // 但照真页面发是零成本的对齐。老工程 `xianyu_shop.js` 的 `request()` 就是
    // 这一套。appKey 页面 `lib.mtop.config` 里没有，是从它自己的请求里抄的。
    return client.request({
      api: String(a.api || 'mtop.taobao.idle.pc.detail'),
      v: String(a.v || '1.0'),
      data: { itemId: itemId },
      type: 'POST', dataType: 'json',
      appKey: String(a.appKey || '34839810'),
      accountSite: 'xianyu', sessionOption: 'AutoLoginOnly',
      needLogin: false, ecode: 0, showErrorToast: false,
      timeout: 20000,
      ext_querys: xyTracking()
    }).then(function (res) {
      var item = (res && res.data && res.data.itemDO) || {};
      return {
        desc: descOf(item),
        images: detailImagesOf(item),
        title: typeof item.title === 'string' ? item.title : ''
      };
    });
  };

  // 描述是一棵富文本树，存成 JSON 字符串：
  //
  //   {"children":[{"children":[{"text":"…","type":"Text",…}],…}],…}
  //
  // 按文档顺序把 `text` 收起来，顶层每个 children 之间断一行 —— 那是卖家
  // 自己分的段，断行保住它比拼成一整坨可读得多（这段会原样进 AI 的提示词）。
  function descOf(item) {
    var raw = item && item.richTextDesc;
    if (typeof raw !== 'string' || raw === '') {
      // 有的商品可能是纯文本字段。**挨个试，不假设只有一种形状。**
      var alt = (item && (item.desc || item.content || item.description)) || '';
      return typeof alt === 'string' ? alt.trim() : '';
    }
    var tree;
    try {
      tree = JSON.parse(raw);
    } catch (e) {
      // 解不开就当纯文本用 —— 半段描述也比没有强。
      return raw.trim();
    }
    function collect(node, out) {
      if (node === null || typeof node !== 'object') { return; }
      if (Object.prototype.toString.call(node) === '[object Array]') {
        for (var i = 0; i < node.length; i++) { collect(node[i], out); }
        return;
      }
      if (typeof node.text === 'string' && node.text !== '') { out.push(node.text); }
      if (node.children) { collect(node.children, out); }
    }
    var blocks = [];
    var top = (tree && tree.children) || [];
    if (Object.prototype.toString.call(top) !== '[object Array]') { top = [top]; }
    for (var i = 0; i < top.length; i++) {
      var out = [];
      collect(top[i], out);
      var line = out.join('').trim();
      if (line !== '') { blocks.push(line); }
    }
    if (blocks.length === 0) {
      var all = [];
      collect(tree, all);
      return all.join('').trim();
    }
    return blocks.join('\n');
  }

  // 全部主图。**只从 `imageInfos` 取** —— 响应里还散落着卖家头像、信用徽章、
  // 各种图标（`sellerDO.portraitUrl`、`levelTags[].iconUrl`…），把它们喂给
  // 多模态是纯浪费，而多模态有张数上限，浪费掉的位置就是尺码表的位置。
  function detailImagesOf(item) {
    var out = [];
    var infos = item && item.imageInfos;
    if (Object.prototype.toString.call(infos) !== '[object Array]') { return out; }
    var major = [];
    var rest = [];
    for (var i = 0; i < infos.length; i++) {
      var it = infos[i];
      if (!it || typeof it !== 'object') { continue; }
      var u = typeof it.url === 'string' ? it.url : '';
      if (u === '') { continue; }
      (it.major === true ? major : rest).push(u);
    }
    major.concat(rest).forEach(function (u) {
      for (var j = 0; j < out.length; j++) { if (out[j] === u) { return; } }
      out.push(u);
    });
    return out;
  }

  // ---- 千牛：商品详情（买家侧的商品页接口） --------------------------------
  //
  // # 两个接口，各管一半
  //
  //   mtop.taobao.detail.getdetail  v6.0  { itemNumId }
  //     → data.item.title / data.item.images[]
  //     → **描述不在里面**，只给了几个 descUrl
  //   mtop.taobao.detail.getdesc  { id, detail_v, preferWireless }
  //     → 描述在这儿
  //
  // # 描述可能是文字，也可能是图 —— 两样都要
  //
  // 淘宝的图文详情两种形式都有。**只取文字会漏掉一半商品**（尺码表、参数表
  // 常常是图），只取图又会丢掉写了字的那些。
  //
  // # 图的顺序有讲究，而这里有一条还没验的线索
  //
  // 真机上那件商品**图文详情是空的**，页面里却有两张 `descV8-singleImage` ——
  // 多半是平台自己插的（保障条款、活动横幅之类）。把它们无差别塞给多模态，
  // 等于拿横幅去占 `MAX_IMAGES` 那几个位置，而**尺码表就是这么被挤掉的**。
  //
  // 线索是：卖家自己传的图，路径里带着卖家 id（`imgextra/i1/<卖家id>/O1CN…`），
  // 平台的那张没有。所以按这个**排序** —— 只排序，不过滤：排错了只是顺序不
  // 理想，过滤错了会把真描述丢掉，而丢掉是看不见的。
  //
  // 主图始终排最前：它说明这是什么东西，而且它一定是卖家自己的。
  ops.fetchQianniuDetail = function (args) {
    var a = args || {};
    var client = mtopClient();
    if (!client) {
      throw new Error('页面里没有可用的 mtop 客户端 —— 详情接口调不了');
    }
    var itemId = String(a.itemId || '');
    if (itemId === '') { throw new Error('没有给出商品 id'); }

    // **接口名走配置。** 淘宝改接口时改配置文件那一行，不发版 ——
    // 与「地址必须走配置」是同一条理由。
    var detailApi = String(a.detailApi || 'mtop.taobao.detail.getdetail');
    var detailV = String(a.detailV || '6.0');
    var descApi = String(a.descApi || 'mtop.taobao.detail.getdesc');
    var descV = String(a.descV || '7.0');
    // # 客户端标识
    //
    // `getdesc` 缺了它会回 `FAIL_SYS_SERVICE_INNER_FAULT::服务内部故障` ——
    // **那句话的意思不是「服务器坏了」，是「你不像个正经客户端」**。
    // 而同一个网关上的 `getdetail` 不带它也通，两个接口的门槛不一样。
    var descTtid = String(a.descTtid || '');

    // 这一段像不像人写的商品描述。
    //
    // # 为什么要这么挑剔
    //
    // 挑出来的东西会原样进 `商品信息`，再原样进 AI 的提示词，最后 AI 拿它去
    // 回答买家。**一段乱码比什么都没有更糟** —— 空着的话 AI 至少知道自己不
    // 知道；一段埋点参数会让它以为那是商品资料。
    //
    // 必须有中文这一条最管用：商品描述是写给中国买家看的，而字段名、枚举值、
    // 埋点参数、样式串全是纯 ASCII。
    function looksLikeProse(t) {
      if (typeof t !== 'string') { return false; }
      var v = t.trim();
      if (v.length < 8 || v.length > 2000) { return false; }
      if (/^(https?:)?\/\//.test(v)) { return false; }
      var c0 = v.charAt(0);
      if (c0 === '{' || c0 === '[') { return false; }
      if (v.indexOf('<') !== -1 && v.indexOf('>') !== -1) { return false; }
      return /[\u4e00-\u9fa5]/.test(v);
    }

    // **按文档顺序收**，不按长度排 —— 描述本来就是有顺序的，重排之后读起来
    // 是几段互不相干的话。
    function pickAlicdn(node, out, texts) {
      if (node === null || node === undefined) { return; }
      if (typeof node === 'string') {
        if (/^(https?:)?\/\/[^\s\"]*alicdn/.test(node)) {
          for (var i = 0; i < out.length; i++) { if (out[i] === node) { return; } }
          out.push(node);
        } else if (looksLikeProse(node)) {
          var v = node.trim();
          for (var m = 0; m < texts.length; m++) { if (texts[m] === v) { return; } }
          texts.push(v);
        }
        return;
      }
      if (typeof node !== 'object') { return; }
      if (Object.prototype.toString.call(node) === '[object Array]') {
        for (var j = 0; j < node.length; j++) { pickAlicdn(node[j], out, texts); }
        return;
      }
      var ks = Object.keys(node);
      for (var k = 0; k < ks.length; k++) { pickAlicdn(node[ks[k]], out, texts); }
    }

    return client.request({
      api: detailApi, v: detailV,
      data: { itemNumId: itemId },
      type: 'GET', dataType: 'json', timeout: 15000
    }).then(function (res) {
      var item = (res && res.data && res.data.item) || {};
      var images = [];
      var arr = item.images;
      if (Object.prototype.toString.call(arr) === '[object Array]') {
        for (var i = 0; i < arr.length; i++) {
          if (typeof arr[i] === 'string' && arr[i] !== '') { images.push(arr[i]); }
        }
      }
      var title = typeof item.title === 'string' ? item.title : '';

      // 描述那一半。**失败不往上抛** —— 主图和标题已经拿到了，
      // 为描述丢掉整件商品不值得。
      var descOpt = {
        api: descApi, v: descV,
        data: { id: itemId, detail_v: '3.3.0', preferWireless: 'true' },
        // 页面自己那次用的是 jsonp。跟着它走 —— 这一条和 ttid 是同一类事：
        // 越像页面自己发的，越不容易被当成异常流量。
        type: 'GET', dataType: 'jsonp', timeout: 15000,
        AntiFlood: true, AntiCreep: true
      };
      if (descTtid !== '') { descOpt.ttid = descTtid; }
      return client.request(descOpt).then(function (d) {
        var descImgs = [];
        var texts = [];
        pickAlicdn(d && d.data, descImgs, texts);

        // 卖家 id：从主图路径里抠（`imgextra/i1/<卖家id>/O1CN…`）。
        // 抠不到就不排序 —— 见上面那段，这是线索不是定论。
        var sellerId = '';
        for (var q = 0; q < images.length && sellerId === ''; q++) {
          var sm = /imgextra\/i\d+\/(\d{6,})\//.exec(images[q]);
          if (sm) { sellerId = sm[1]; }
        }
        if (sellerId !== '') {
          var mine = [];
          var theirs = [];
          for (var w = 0; w < descImgs.length; w++) {
            (descImgs[w].indexOf('/' + sellerId + '/') !== -1 ? mine : theirs)
              .push(descImgs[w]);
          }
          descImgs = mine.concat(theirs);
        }

        for (var i = 0; i < descImgs.length; i++) {
          var u = descImgs[i];
          var dup = false;
          for (var j = 0; j < images.length; j++) { if (images[j] === u) { dup = true; } }
          if (!dup) { images.push(u); }
        }
        // 按顺序拼，总长封顶 —— 这一段会进 AI 的提示词，而提示词是按字收费的。
        var desc = '';
        for (var t = 0; t < texts.length; t++) {
          if (desc.length + texts[t].length > 1200) { break; }
          desc += (desc === '' ? '' : '\n') + texts[t];
        }
        return { desc: desc, images: images, title: title };
      }).catch(function (e) {
        return {
          desc: '', images: images, title: title,
          descError: String((e && (e.ret || e.message)) || e)
        };
      });
    });
  };

  // ---- 等某个东西出现：布防一次，命中了推一条 ------------------------------
  //
  // # 为什么不是「调一次，等它命中再返回」
  //
  // 那是一次长调用，而**任何跨越导航的调用都会被作废**。等表格出现动辄几十秒，
  // 而卖家中心自己就会跳（登录完成、SPA 启动完重新路由）—— 于是最常见的一次
  // 使用恰好是最容易失败的一次。真机上就是这么报出「页面已导航」的。
  //
  // 改成：**布防是短调用，命中靠推**。Rust 那边盯着装桥代数，页面一跳就重新
  // 布防一次。导航不再是「打断」，只是「重来一次布防」。
  //
  // # 双保险
  //
  // `MutationObserver` 看不见 shadow DOM 里的变化，也看不见 canvas 画出来的
  // 内容。所以再挂一个 500ms 的自检 —— 它**在页面里**，不产生任何跨进程调用，
  // 与「每秒从 Rust 问一次」完全是两回事。
  var watches = {};

  function clearWatch(name) {
    var w = watches[name];
    if (!w) { return; }
    try { w.ob.disconnect(); } catch (e) { /* 已经没了 */ }
    if (w.timer) { stopEvery(w.timer); }
    delete watches[name];
  }

  ops.watchSelector = function (args) {
    var a = args || {};
    var name = String(a.name || '');
    if (name === '') { throw new Error('watchSelector 要一个名字'); }
    var sel = a.selectors;
    var minCount = Number(a.minCount) > 0 ? Number(a.minCount) : 1;
    var settleMs = Number(a.settleMs) >= 0 ? Number(a.settleMs) : 0;

    clearWatch(name);

    function count() { return queryTwoLevel(document, sel).length; }
    // 给 `pageGlance` 看的：这道布防现在什么状态。**排查「命中了却没推事件」
    // 只有这几个数能回答**（2026-09-05 快手编辑页）。
    var state = { armedAt: Date.now(), lastCount: 0, fired: false, posted: false, checks: 0 };
    function fire() {
      clearWatch(name);
      state.posted = true;
      post({ kind: 'event', name: name, data: { count: count(), href: location.href } });
    }
    // **先立刻查一次。** 布防的那一刻它可能已经在了 —— 只等变化的话会一直等
    // 一个永远不会再发生的变化。
    state.lastCount = count();
    if (state.lastCount >= minCount) {
      // `settleMs` 给那些「先渲染一部分再补齐」的表格：命中之后再等一小会儿
      // 让它长全，否则读到的是半张表，而半张表与整张表长得一样。
      state.fired = true;
      if (settleMs > 0) {
        watches[name] = { ob: { disconnect: function () {} }, timer: null, state: state };
        later(fire, settleMs);
        return { armed: true, already: true };
      }
      fire();
      return { armed: false, already: true };
    }

    var fired = false;
    function check() {
      state.checks += 1;
      if (fired) { return; }
      state.lastCount = count();
      if (state.lastCount < minCount) { return; }
      fired = true;
      state.fired = true;
      if (settleMs > 0) { later(fire, settleMs); } else { fire(); }
    }

    var ob = new MutationObserver(check);
    try {
      ob.observe(document.documentElement || document.body, {
        childList: true, subtree: true
      });
    } catch (e) {
      // 文档还没成形。兜底轮询照样能接住。
    }
    watches[name] = { ob: ob, timer: every(check, 500), state: state };
    return { armed: true, already: false };
  };

  // 布防的现场：给 `pageGlance` 用。`fire` 之后那道布防已经从表里摘掉，
  // 所以另留一份最近几道的状态，摘掉了也还查得到。
  var recentWatches = {};
  var _origWatch = ops.watchSelector;
  ops.watchSelector = function (args) {
    var r = _origWatch(args);
    var name = String((args || {}).name || '');
    if (watches[name]) { recentWatches[name] = watches[name].state; }
    return r;
  };

  ops.unwatchSelector = function (args) {
    clearWatch(String((args || {}).name || ''));
    return { ok: true };
  };

  // ---- 千牛：商品页上的属性、尺码表、详情图 --------------------------------
  //
  // # 为什么读 DOM 而不是调接口
  //
  // `getdetail` 只给标题和主图；`getdesc` 被反爬挡着（页面自己那次请求带着
  // `_bx-` 开头的反爬标记，而我们拿到的是底下那个裸的 mtop 客户端）。
  //
  // 而商品页 DOM 上**属性和尺码表都是文字**：
  //
  //     品牌 Dickies / 材质成分 莱赛尔纤维79.8% 亚麻20.2% / 尺码 3XL 2XL XL S M L
  //     适合身高体重: 170-175cm/62.5-70kg   腰围: 76-99cm   臀围: 110cm
  //
  // 拿到文字就不用让多模态去图里认尺码 —— 而「认尺码表」正是学习提示词的
  // 第一条，也是最容易认错的一条：**编出来的尺码会让买家收到错货**。
  //
  // # 详情图不用滚页面
  //
  // 它们是懒加载的，`src` 是一张 1×1 的占位 gif。但真地址一开始就挂在
  // `data-src` 上 —— 直接读那个，省掉一整轮滚动等待。
  // 读商品页之前**先滚一遍**。
  //
  // # 这不是保险，是必需
  //
  // 2026-08-30 真机量的（`item.taobao.com/item.htm?id=…`，同一个页面，
  // 滚之前 / 滚之后）：
  //
  //   属性 generalParamsInfoItem   0 条  →  有
  //   尺码 summaryKey              0 条  →  有
  //
  // 淘宝商品页是滚动懒加载的，而我们原先是「导航完、等页面站稳、立刻读」。
  // 于是**属性和尺码一直读到的是 0 条** —— 而那两样恰恰是千牛这条路最值钱的
  // 产出：拿到文字就不用让多模态去图里认尺码，而认错的尺码会让买家收到错货。
  //
  // 更糟的是它不报错：多模态照样写出问答，界面上「学完了 30 件」与真的学到了
  // 长得一模一样。
  //
  // # 为什么滚完要滚回顶部
  //
  // 这个页面商家可能正看着（学习期间录入页面是显示出来的）。把它留在底部
  // 是我们动过它的痕迹；滚回去，他看到的还是他离开时的样子。
  //
  // # 时间预算
  //
  // 12 步 × 300ms + 800ms 沉淀 ≈ 4.4 秒，而慢通道给的是 60 秒。
  function scrollThrough() {
    return new Promise(function (resolve) {
      var steps = 0;
      function step() {
        try {
          window.scrollBy(0, Math.round(window.innerHeight * 0.9));
        } catch (e) { /* 滚不动就算了，下面照读 */ }
        steps++;
        var atBottom = false;
        try {
          atBottom = (window.scrollY + window.innerHeight) >= (document.body.scrollHeight - 10);
        } catch (e) { atBottom = true; }
        if (steps < 12 && !atBottom) {
          later(step, 300);
        } else {
          // 懒加载的内容要一点时间才渲染出来。
          later(function () {
            try { window.scrollTo(0, 0); } catch (e) { /* 同上 */ }
            resolve(steps);
          }, 800);
        }
      }
      step();
    });
  }

  ops.readTaobaoItemPage = function (args) {
    var a = args || {};
    var sel = a.selectors || {};

    function all(tl) { return queryTwoLevel(document, tl); }
    function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

    // **先滚，再读。** 见上面 `scrollThrough` 的说明。
    return scrollThrough().then(function (scrolled) {
    // 属性：容器元素的 innerText 就是「名 值」，不用再去拆 title/subtitle。
    var attrs = [];
    all(sel.itemAttr).forEach(function (el) {
      var t = clean(el.innerText || el.textContent);
      if (t !== '' && t.length <= 120 && attrs.indexOf(t) === -1) { attrs.push(t); }
    });

    // 尺码表：一组一组读，键和值在同一个父容器里。
    var sizes = [];
    all(sel.itemSizeKey).forEach(function (k) {
      var box = k.parentElement;
      if (!box) { return; }
      var v = queryTwoLevel(box, sel.itemSizeValue)[0];
      var kt = clean(k.innerText || k.textContent).replace(/[:：]\s*$/, '');
      var vt = v ? clean(v.innerText || v.textContent) : '';
      if (kt === '' || vt === '') { return; }
      var line = kt + '：' + vt;
      if (sizes.indexOf(line) === -1) { sizes.push(line); }
    });

    // 详情图：**读 data-src**，不是 src。
    var images = [];
    all(sel.itemDescImg).forEach(function (im) {
      var u = im.getAttribute('data-src') || im.getAttribute('src') || '';
      if (u === '' || u.indexOf('g.alicdn.com/s.gif') !== -1) { return; }
      if (images.indexOf(u) === -1) { images.push(u); }
    });

    var titleEl = all(sel.itemTitle)[0];
    return {
      title: titleEl ? clean(titleEl.innerText || titleEl.textContent) : '',
      attrs: attrs,
      sizes: sizes,
      images: images,
      // 滚了几步。**读到 0 条属性时这个数是唯一的线索** —— 滚了 12 步仍然
      // 0 条，说明是选择器的问题；滚了 1 步就到底，说明页面根本没展开。
      scrolled: scrolled
    };
    });
  };

  // ---- 京麦：接口通道 -------------------------------------------------------
  //
  // # 与下面那张表格的关系
  //
  // 下面 `readSellerTable` 那组是**读 DOM**：抖店、京麦、拼多多共用一份画像，
  // 读商家后台那张商品表，再逐件打开卖家编辑页取属性。京麦 200 件商品走那条
  // 要开 200 次编辑页（约 57 分钟），而且表格里的标题是**截断**的 ——
  // 真机上那一格给的是「男士休闲直筒裤」，真标题是「男士休闲直筒裤秋冬商务
  // 正装西裤修身百搭通勤裤子」，而截断了不报错。
  //
  // 这一组改成问页面自己的读接口：清单几次请求拿完全部，详情只对商家**真正
  // 勾选**的那几件发。老工程（`shopscraper_gui_v3/_internal/jingmai_shop.js`）
  // 是一次 `getAll` 把每件的详情都打一遍；我们的流程是「先列清单、商家挑、
  // 再学」，所以详情那一半按需发，比它还省一半请求。
  //
  // # 为什么这不是「绕过防护」
  //
  // **签名不是我们算的。** `jdHttpClient()` 从页面自己的 webpack 模块里取它
  // 自己的 http 客户端（真机 2026-09-12：`module#24941` 第一个就命中），请求
  // 由它发出去，该带的头、该算的令牌都是页面自己那套。我们既不伪造签名，也
  // 不复用抓来的签名头 —— 那两件事是明确不做的。
  //
  // # 失败不抛，退回 DOM
  //
  // 任何一步不成（模块 ID 变了、接口改名、返回看不懂）都返回 `ok: false` 加
  // 一句原因，Rust 据此走 `readSellerTable`。**接口这条是加速，不是依赖** ——
  // 它没了只是慢回去，不是读不到商品。

  var JD_APP_ID = '3MC69M4R3HFKCQ4S01DN';
  var JD_ACCESS = { source: 'web', businessModel: '0', proxyBelongBizId: '', originType: null };
  var JD_LIST_API = 'dsm.product.manage.ProductInfoReadViewService.queryValidProductList';
  var JD_SKU_API = 'dsm.product.manage.SkuInfoReadViewService.querySkuList';
  var JD_DETAIL_API = 'dsm.productbff.product.warePublishPageParamsService.getWarePublishPageParamsNew';

  // 页面自己的 http 客户端。照老工程那三条路依次试，取到哪条记下来 ——
  // 读不到商品时，「走的是哪条」是排查的第一个问题。
  var jdClientPath = '';
  function jdHttpClient() {
    try {
      var req = window.__jdm_webpack_require__;
      var chunks = window.webpackChunkpc_vue3_shop_ware_shop_static_plus;
      if (!req && chunks && typeof chunks.push === 'function') {
        chunks.push([[Date.now()], {}, function (webpackRequire) {
          window.__jdm_webpack_require__ = webpackRequire;
        }]);
        req = window.__jdm_webpack_require__;
      }
      if (!req) { return null; }
      var ids = [24941, 18108, 66186];
      for (var i = 0; i < ids.length; i++) {
        try {
          var mod = req(ids[i]);
          var client = mod && (mod.Z || mod.default || mod);
          if (client && typeof client.post === 'function') {
            jdClientPath = 'module#' + ids[i];
            return client;
          }
        } catch (_) { /* 这个模块不属于当前页面 */ }
      }
      // 三个写死的 ID 都不在了（改版的第一个症状）。扫一遍模块缓存再试 ——
      // 比直接掉到 sff 兜底稳：那条路没有页面的拦截器。
      var cache = req.c || {};
      for (var key in cache) {
        if (!Object.prototype.hasOwnProperty.call(cache, key)) { continue; }
        var exp = cache[key] && cache[key].exports;
        var cands = [exp, exp && exp.Z, exp && exp.default];
        for (var j = 0; j < cands.length; j++) {
          var c = cands[j];
          if (c && typeof c.post === 'function' && c.defaults) {
            jdClientPath = 'cache#' + key;
            return c;
          }
        }
      }
    } catch (_) { /* 退到 sff 兜底 */ }
    return null;
  }

  function jdCall(api, body) {
    var client = jdHttpClient();
    if (client) {
      return client.post('/dsm/' + api, body, { plugin: { commonError: false } })
        .then(function (r) { return (r && r.data !== undefined) ? r.data : r; });
    }
    // 兜底：京麦自己的 SFF 网关。**不是伪造** —— 这个地址页面自己也在用，
    // 身份靠 cookie（credentials include），没有我们算出来的东西。
    jdClientPath = 'sff';
    return fetch('https://sff.jd.com/api?v=1.0&appId=' + JD_APP_ID + '&api=' + api, { // gate-allow: 与 JD_APP_ID、dsm 接口名同属一份京麦契约；只把地址挪进配置、接口名留在代码里是假的可配置性
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.text().then(function (text) {
        var json;
        try { json = JSON.parse(text); }
        catch (_) { throw new Error(api + ' 返回的不是 JSON：' + text.slice(0, 200)); }
        if (!res.ok) { throw new Error(api + ' HTTP ' + res.status); }
        return json;
      });
    });
  }

  function jdIsArray(v) { return Object.prototype.toString.call(v) === '[object Array]'; }

  function jdRowsOf(v) {
    if (!v || typeof v !== 'object') { return []; }
    var direct = ['data', 'rows', 'list', 'records', 'items'];
    for (var i = 0; i < direct.length; i++) {
      if (jdIsArray(v[direct[i]])) { return v[direct[i]]; }
    }
    var nest = ['data', 'result', 'pageResult', 'page', 'body'];
    for (var j = 0; j < nest.length; j++) {
      var r = jdRowsOf(v[nest[j]]);
      if (r.length) { return r; }
    }
    return [];
  }

  function jdTotalOf(v) {
    if (!v || typeof v !== 'object') { return 0; }
    var keys = ['totalCount', 'total', 'count'];
    for (var i = 0; i < keys.length; i++) {
      var raw = v[keys[i]];
      if (raw === null || raw === undefined) { continue; }
      var n = Number(raw);
      if (isFinite(n)) { return n; }
    }
    var nest = ['data', 'result', 'pageResult', 'page', 'body'];
    for (var j = 0; j < nest.length; j++) {
      var t = jdTotalOf(v[nest[j]]);
      if (t) { return t; }
    }
    return 0;
  }

  // 京东的图字段多数是 jfs/t1/... 这样的相对路径，要补域名才下得下来。
  function jdImg(v) {
    if (!v) { return ''; }
    v = String(v);
    if (v.indexOf('//') === 0) { return 'https:' + v; }
    if (/^https?:\/\//.test(v)) { return v; }
    return 'https://img10.360buyimg.com/n1/' + v.replace(/^\//, ''); // gate-allow: 接口返回的是 jfs/... 相对路径，这是京东自己给它补的域名，不是我们选的地址
  }

  // 清单上那一行显示的价格。
  //
  // # 为什么不能用 `priceDetailVO.jdPrice`
  //
  // **SPU 上那个 `jdPrice` 是陈年旧值。** 2026-09-12 真机，同一件商品：
  //
  //   页面显示            ¥59.00
  //   priceDetailVO.minJdPrice   59     ← 真的
  //   priceDetailVO.maxJdPrice   59     ← 真的
  //   priceDetailVO.jdPrice   99999     ← 商家很久以前设的，再没更新过
  //
  // 老工程的 `priceOf()` 取的正是 `jdPrice ?? inclusiveArrivalPrice`，
  // 所以它导出的价格也是错的 —— 这一处**照抄它就是抄了个 bug**。
  //
  // 更要紧的是：原先读 DOM 那条路是**对的**（它读 `span.price-box-num`，
  // 页面上写什么就是什么）。接口通道要是取 `jdPrice`，等于为了快把一个
  // 本来正确的数字换成了错的，而商家要拿它决定为哪几件商品付钱。
  //
  // min/max 是 SKU 价的区间，与页面显示的是同一个来源。两头不一样时给区间，
  // 不取其中一个 —— 「59」和「59 ~ 199」对商家是两件事。
  function jdListPrice(p) {
    var d = (p && p.priceDetailVO) || {};
    var lo = d.minJdPrice, hi = d.maxJdPrice;
    var has = function (v) { return v !== undefined && v !== null && v !== ''; };
    if (has(lo) && has(hi)) { return String(lo) === String(hi) ? String(lo) : (lo + ' ~ ' + hi); }
    if (has(lo)) { return String(lo); }
    if (has(hi)) { return String(hi); }
    // 区间都没有才退到 SPU 那几个。**排在最后**：它们可能是旧的，但有个数
    // 总比清单上一片空白强 —— 空白会让商家以为这件商品没定价。
    if (has(d.jdPrice)) { return String(d.jdPrice); }
    if (has(d.inclusiveArrivalPrice)) { return String(d.inclusiveArrivalPrice); }
    if (has(p.jdPrice)) { return String(p.jdPrice); }
    return '';
  }

  function jdListQuery(over) {
    var q = {
      productName: null, skuIdList: null, categoryIdList: null, productIdList: null,
      salesVolume: null, jdPrice: null, shopCategory: null, stockNum: null, brandIdList: [],
      itemNum: null, onlineTime: null, productType: null, productState: '4',
      startOnlineTime: null, endOnlineTime: null, startOfflineTime: null, endOfflineTime: null,
      startCreated: null, endCreated: null, startModified: null, endModified: null,
      categoryIds: [], minSalesVolume: null, maxSalesVolume: null, minJdPrice: null,
      maxJdPrice: null, minStockNum: null, maxStockNum: null, supplyProductIdList: null,
      supplySkuIdList: null, sortMap: { modified: 'desc' }, pageNum: 1, pageSize: 50
    };
    for (var k in (over || {})) {
      if (Object.prototype.hasOwnProperty.call(over, k)) { q[k] = over[k]; }
    }
    return { productListQueryReq: q, accessContext: JD_ACCESS };
  }

  // **属性字典只从 template 建，取值只认 productProp。**
  //
  // 这是这一段里最容易写错、而且错了看不出来的地方。`template` 是这个**类目**
  // 的发布表单：`props.options` 里是色板全部 11 种颜色、面料全部 50 多种。
  // 它不是这件商品的属性。老工程那套盲扫（`detailInfo()` 按 propertyName /
  // valueName 满树找）在京东这个响应上抽到 0 条 —— 而万一哪天键名对上了，
  // 它会把整张色板当成这件商品的属性存进知识库，AI 就会告诉买家有紫色、
  // 藏青色、桔红色。
  //
  // 所以分成两件事：template 只提供「id => 名字」和「取值id => 标签」，
  // 哪些取值**属于这件商品**只看 `product.productProp`。
  function jdAttrDict(tpl) {
    var dict = {}, seen = [];
    function take(list, entry) {
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (!o || typeof o !== 'object') { continue; }
        if (o.value !== null && o.value !== undefined && o.label !== null && o.label !== undefined) {
          entry.values[String(o.value)] = String(o.label);
        }
        // 选项有两层嵌套，名字还不一样：级联属性用 subOptions，颜色用 children。
        if (jdIsArray(o.subOptions)) { take(o.subOptions, entry); }
        if (jdIsArray(o.children)) { take(o.children, entry); }
      }
    }
    function walk(n, depth) {
      if (!n || typeof n !== 'object' || depth > 10 || seen.indexOf(n) >= 0) { return; }
      seen.push(n);
      if (jdIsArray(n)) {
        for (var i = 0; i < n.length; i++) { walk(n[i], depth + 1); }
        return;
      }
      var id = (n.field !== undefined && n.field !== null) ? n.field : n.componentId;
      var name = n.title;
      if (id !== undefined && id !== null && typeof name === 'string' && name !== '') {
        var key = String(id);
        if (!dict[key]) { dict[key] = { name: name, values: {} }; }
        dict[key].name = name;
        if (n.props && jdIsArray(n.props.options)) { take(n.props.options, dict[key]); }
      }
      for (var k in n) {
        if (Object.prototype.hasOwnProperty.call(n, k)) { walk(n[k], depth + 1); }
      }
    }
    walk(tpl, 0);
    return dict;
  }

  // 把 {"132917":"709512"} 翻成「面料: 毛呢」。
  //
  // 对不上的**不丢也不编**：`unresolved` 带回去进日志。属性字典跟着类目走，
  // 而商家的品类五花八门 —— 哪一类对不上，只有真机上才看得出来。
  function jdResolveProps(props, dict) {
    var out = [], unresolved = [];
    for (var id in (props || {})) {
      if (!Object.prototype.hasOwnProperty.call(props, id)) { continue; }
      var meta = dict[id];
      if (!meta || !meta.name) { unresolved.push('名字?' + id); continue; }
      var raw = props[id];
      var arr = jdIsArray(raw) ? raw : [raw];
      var vals = [];
      for (var i = 0; i < arr.length; i++) {
        var v = arr[i];
        if (v && typeof v === 'object') {
          // 成分那种带占比的：{unit:'%', percentValue:'5', value:'788165'}
          var lab = meta.values[String(v.value)];
          if (lab === undefined) { lab = String(v.value); unresolved.push(id + ':' + v.value); }
          vals.push(v.percentValue ? (lab + ' ' + v.percentValue + (v.unit || '')) : lab);
        } else {
          var l2 = meta.values[String(v)];
          if (l2 === undefined) { unresolved.push(id + ':' + v); l2 = String(v); }
          if (l2 !== '') { vals.push(l2); }
        }
      }
      if (vals.length) { out.push(meta.name + ': ' + vals.join('、')); }
    }
    return { attrs: out, unresolved: unresolved };
  }

  // SKU 的规格文字（「XS」「通用尺码: XS」）。**照老工程的 parseAlias 抄。**
  //
  // 这个字段有四种形态，真机上都见得到：
  //   - 数组：`["XS"]`                               ← 2026-09-12 真机就是这个
  //   - 数组套 JSON 字符串：`saleAttrs[].attrValueAlias`
  //     里是 `'[{"modelName":"通用尺码","value":"XS"}]'`
  //   - 对象：`{modelName, value}`
  //   - 光秃秃一个字符串
  //
  // 少认一种的后果不是报错，是**退到 `skuName`** —— 而 `skuName` 是「整个
  // 商品标题 + 规格」（真机：「男士休闲直筒裤秋冬商务正装西裤修身百搭通勤
  // 裤子 XS」）。那样每一行规格里都重复一遍标题，既难读，又白占
  // `PRODUCT_INFO_MAX_CHARS` 那 2400 字的预算。
  function jdParseAlias(value) {
    if (value === undefined || value === null || value === '') { return []; }
    var out = [], i;
    if (jdIsArray(value)) {
      for (i = 0; i < value.length; i++) { out = out.concat(jdParseAlias(value[i])); }
      return out;
    }
    if (typeof value === 'object') {
      var name = value.modelName || value.name;
      if (name) {
        var v = (value.value !== undefined && value.value !== null) ? value.value
          : ((value.valueName !== undefined && value.valueName !== null) ? value.valueName : '');
        return [name + ': ' + v];
      }
      for (var k in value) {
        if (Object.prototype.hasOwnProperty.call(value, k)) { out = out.concat(jdParseAlias(value[k])); }
      }
      return out;
    }
    var text = String(value).trim();
    if (text.charAt(0) === '[' || text.charAt(0) === '{') {
      try { return jdParseAlias(JSON.parse(text)); } catch (_) { /* 就是一句普通别名 */ }
    }
    return text ? [text] : [];
  }

  function jdUnique(list) {
    var seen = {}, out = [];
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      if (v === '' || v === null || v === undefined) { continue; }
      if (!Object.prototype.hasOwnProperty.call(seen, v)) { seen[v] = 1; out.push(v); }
    }
    return out;
  }

  function jdSkuSpec(sku) {
    var direct = jdParseAlias(sku.saleAttrAlias);
    if (direct.length) { return jdUnique(direct).join('; '); }
    var parts = [], attrs = sku.saleAttrs || [];
    for (var i = 0; i < attrs.length; i++) {
      var a = attrs[i] || {};
      parts = parts.concat(jdParseAlias(a.attrValueAlias || a.attrValues || []));
    }
    return jdUnique(parts).join('; ') || '默认规格';
  }

  // 在一棵树里找第一个叫这个名字的键。**按键名找，不按路径找。**
  //
  // `allCategoryPathNameList` 藏在详情响应三十多万字节里的某一层（真机上它
  // 挨着 `isRentDFVender`、`isExistApply` 这些字段）。把那条路径写死，平台
  // 挪一层我们就静默地少一条类目 —— 而键名比路径稳得多。
  function jdFindKey(root, key) {
    var seen = [];
    function walk(n, depth) {
      if (!n || typeof n !== 'object' || depth > 12 || seen.indexOf(n) >= 0) { return undefined; }
      seen.push(n);
      if (jdIsArray(n)) {
        for (var i = 0; i < n.length; i++) {
          var r = walk(n[i], depth + 1);
          if (r !== undefined) { return r; }
        }
        return undefined;
      }
      if (Object.prototype.hasOwnProperty.call(n, key) && n[key] !== null && n[key] !== undefined) {
        return n[key];
      }
      for (var k in n) {
        if (!Object.prototype.hasOwnProperty.call(n, k)) { continue; }
        var r2 = walk(n[k], depth + 1);
        if (r2 !== undefined) { return r2; }
      }
      return undefined;
    }
    return walk(root, 0);
  }

  // 尺码表那些围度的 attrId => 名字。
  //
  // **与商品属性那本字典分开建。** 那本（`jdAttrDict`）认的是 `field` /
  // `componentId` 加 `title`，而尺码表这边的 id 挂在 `attrId` 上，名字有时
  // 在 `attrName`。把两边的键名合到一本字典里，会让商品属性那 14 条面临被
  // 一个同号的选项节点顶掉的风险 —— 那 14 条现在是零失误，不值得赌。
  //
  // **先到先得**：模板里「商品尺码表」排在「尺码推荐表」「试穿报告」前面，
  // 而后两节里有重名的项（23502 既是「通用尺码」也是「试穿尺码」）。按顺序
  // 走、第一个赢，拿到的就是主表那一份。
  function jdSizeDict(tpl) {
    var dict = {}, seen = [];
    function walk(n, depth) {
      if (!n || typeof n !== 'object' || depth > 9 || seen.indexOf(n) >= 0) { return; }
      seen.push(n);
      if (jdIsArray(n)) {
        for (var i = 0; i < n.length; i++) { walk(n[i], depth + 1); }
        return;
      }
      var id = n.attrId;
      if (id === undefined || id === null) { id = n.componentId; }
      if (id === undefined || id === null) { id = n.id; }
      var nm = n.title || n.attrName || n.name || n.label;
      if (id !== undefined && id !== null && typeof nm === 'string' && nm !== '') {
        var key = String(id);
        if (!Object.prototype.hasOwnProperty.call(dict, key)) { dict[key] = nm; }
      }
      for (var k in n) {
        if (Object.prototype.hasOwnProperty.call(n, k)) { walk(n[k], depth + 1); }
      }
    }
    walk(tpl, 0);
    return dict;
  }

  // 尺码表，一行一个尺码。
  //
  // # 为什么这张表对服装店是最值钱的一段
  //
  // 买家问得最多的就是「我 175 穿什么码」。没有这张表，AI 只知道这件衣服
  // 有「均码」和「XS」，答不了任何一个具体的人 —— 而答案本来就写在商家
  // 自己填的那张表里。
  //
  // 真机上它长这样（`attrName` 是 `null`，只有 `attrId`，所以必须 join）：
  //
  //   saleAttr:           [{attrName:'尺码', attrValueAlias:'均码'}]
  //   sizeTableItemAttrs: [{attrId:1000021, values:'180'}, {attrId:1000022, values:'70'}, …]
  //
  // 出来就是：`尺码 均码　身高cm 180　体重kg 70　腰围cm 25　臀围cm 40　裤长cm 10`
  function jdSizeTableLines(pr, sizeDict) {
    var st = pr.productSizeTable || {};
    var tables = jdIsArray(st.sizeTables) ? st.sizeTables : [];
    var lines = [];
    for (var t = 0; t < tables.length; t++) {
      var items = jdIsArray(tables[t] && tables[t].sizeTableItems) ? tables[t].sizeTableItems : [];
      for (var i = 0; i < items.length; i++) {
        var it = items[i] || {}, cells = [];
        var sa = jdIsArray(it.saleAttr) ? it.saleAttr : [];
        for (var s = 0; s < sa.length; s++) {
          var v = sa[s] && sa[s].attrValueAlias;
          if (v !== undefined && v !== null && v !== '') {
            cells.push(((sa[s].attrName || '尺码')) + ' ' + v);
          }
        }
        var attrs = jdIsArray(it.sizeTableItemAttrs) ? it.sizeTableItemAttrs : [];
        for (var a = 0; a < attrs.length; a++) {
          var at = attrs[a] || {};
          if (at.values === undefined || at.values === null || at.values === '') { continue; }
          // **对不上就用 id 兜底，不丢这一格。** 一行尺码里缺一个围度，
          // 买家问到它时 AI 只能说不知道；而「属性1100109 38」至少还是个
          // 能核对的事实。
          var name = at.attrName || sizeDict[String(at.attrId)] || ('属性' + at.attrId);
          cells.push(name + ' ' + at.values);
        }
        if (cells.length) { lines.push('  ' + cells.join('　')); }
      }
    }
    return lines;
  }

  function jdSleep(ms) {
    // 固定间隔本身就是个指纹 —— 与 `replayList` 同一个理由，抖 ±35%。
    var d = Math.round(ms * (0.65 + Math.random() * 0.7));
    return new Promise(function (r) { later(r, d); });
  }

  // 读商品清单。**只发清单请求，不碰任何一件的详情** —— 详情按需，见
  // `jdApiDetail`。
  //
  // 只取在售（productState '4'）：与画像里 `activeTab=OnsaleWare` 一致。
  // 老工程还循环了一个 '2'（下架），2026-09-12 真机上那个值被服务端拒了
  // （「入参的商品状态码不合法」）—— 它用 try/catch 吞掉了所以看不出来。
  ops.jdApiList = function (args) {
    var a = args || {};
    var pageSize = Number(a.pageSize) > 0 ? Number(a.pageSize) : 50;
    var maxPages = Number(a.maxPages) > 0 ? Math.min(Number(a.maxPages), 100) : 100;
    var pageDelay = Number(a.pageDelay) >= 0 ? Number(a.pageDelay) : 400;

    var items = [], seen = {}, pages = 0, declared = 0;

    function step(n) {
      if (n > maxPages) { return Promise.resolve(); }
      return jdCall(JD_LIST_API, jdListQuery({ pageNum: n, pageSize: pageSize })).then(function (json) {
        pages += 1;
        if (n === 1) { declared = jdTotalOf(json); }
        var rows = jdRowsOf(json);
        var fresh = 0;
        for (var i = 0; i < rows.length; i++) {
          var p = rows[i];
          var id = String(p.productId || '');
          var title = String(p.productName || '');
          // 没标题的存不进去 —— 标题是知识库里认商品的主别名。
          if (title === '') { continue; }
          var key = id !== '' ? id : title;
          if (Object.prototype.hasOwnProperty.call(seen, key)) { continue; }
          seen[key] = 1;
          fresh += 1;
          var sku = p.productSkuInfoVO || {};
          items.push({
            title: title,
            itemId: id,
            price: jdListPrice(p),
            thumb: jdImg(p.logo),
            // 别名由 Rust 算（`knowledge::products` 里那套规则），前端不抠。
            alias: '',
            // 清单行上只有一张主图。其余的在详情里，等挑完再取。
            images: p.logo ? [jdImg(p.logo)] : [],
            itemHref: sku.skuUrl || (sku.skuId ? ('https://item.jd.com/' + sku.skuId + '.html') : ''), // gate-allow: 后备而已 —— skuUrl 接口自己就给（真机 2026-09-12 给的就是它），只有它缺席时才拼
            itemStatus: null
          });
        }
        // 一页一个新的都没有 = 到底了。**按「新增」判，不按返回条数** ——
        // 有些接口翻到底之后一直回同一页。
        if (fresh === 0) { return; }
        if (rows.length < pageSize) { return; }
        return jdSleep(pageDelay).then(function () { return step(n + 1); });
      });
    }

    return step(1).then(function () {
      return { ok: true, items: items, pages: pages, declared: declared, clientPath: jdClientPath };
    }, function (e) {
      // **不抛。** Rust 据此退回 DOM 那条。
      return { ok: false, reason: (e && e.message) || String(e), clientPath: jdClientPath, items: [] };
    });
  };

  // 读一件商品的学习素材：属性、SKU 表、描述、图。
  //
  // 三次请求：按 id 查回这一行（要它的类目 id 和 isGXproduct，详情接口的入参）、
  // 查 SKU、查发布页参数。**不靠页面侧缓存** —— 清单那一步和这一步之间页面
  // 可能已经刷新过，而一个「有时候有、有时候没有」的缓存会让失败无从复现。
  ops.jdApiDetail = function (args) {
    var a = args || {};
    var productId = String(a.productId || '').trim();
    if (productId === '') { return Promise.resolve({ ok: false, reason: '没有给出商品 id' }); }
    var itemDelay = Number(a.itemDelay) >= 0 ? Number(a.itemDelay) : 250;
    var row = null;

    return jdCall(JD_LIST_API, jdListQuery({ productIdList: [Number(productId)], pageSize: 1 }))
      .then(function (json) {
        row = jdRowsOf(json)[0];
        if (!row) { throw new Error('按 id 查不到这件商品（可能已下架或已删除）'); }
        return jdSleep(itemDelay);
      })
      .then(function () {
        return jdCall(JD_SKU_API, {
          skuListQueryReq: {
            productId: Number(productId), skuName: null, skuStatusList: [], categoryIds: [],
            brandIdList: [], itemNum: null, skuType: null, startCreated: null, endCreated: null,
            startModified: null, endModified: null, sortMap: { created: 'asc' }, supplyVenderId: null
          }, accessContext: JD_ACCESS
        }).then(jdRowsOf, function (e) {
          // SKU 读不到不该让整件商品失败：属性和描述仍然值得学。
          return { __skuError: (e && e.message) || String(e) };
        });
      })
      .then(function (skus) {
        var skuErr = '';
        if (skus && skus.__skuError) { skuErr = skus.__skuError; skus = []; }
        var cat = row.categoryDetailVO || {};
        return jdCall(JD_DETAIL_API, {
          publishPageInitReq: {
            publishPageType: 4, locType: 0,
            categoryId: Number(cat.lastCategoryId || cat.categoryId3 || 0),
            productId: Number(productId), intelligentPublish: false,
            isGXproduct: Number((row.productFeatureMap && row.productFeatureMap.isGXproduct) || 0),
            recImageInfoList: []
          }
        }).then(function (d) {
          return { skus: skus, skuErr: skuErr, detail: d, detailErr: '' };
        }, function (e) {
          // 详情读不到也不算全败：清单行上的品牌/货号/产地 + SKU 表还在。
          return { skus: skus, skuErr: skuErr, detail: null, detailErr: (e && e.message) || String(e) };
        });
      })
      .then(function (bag) {
        var root = (bag.detail && bag.detail.data && typeof bag.detail.data === 'object')
          ? bag.detail.data : (bag.detail || {});
        var pr = root.product || {};
        var tp = root.template || {};
        var dict = jdAttrDict(tp);
        var resolved = jdResolveProps(pr.productProp, dict);
        // 这个类目一共给了几条属性取值。**与解析出来的条数一起带回去** ——
        // 两个数对不上就是「这个类目的字典没建起来」，而那种失败本身是静默的：
        // 商品照样入库，只是没有属性。见 Rust 侧那条 warn。
        var propCount = 0;
        for (var pk in (pr.productProp || {})) {
          if (Object.prototype.hasOwnProperty.call(pr.productProp, pk)) { propCount++; }
        }

        var lines = [];
        function add(name, value) {
          if (value === undefined || value === null || value === '') { return; }
          lines.push(name + ': ' + value);
        }
        // **完整类目路径**，不是只给末级。
        //
        // 清单行的 `categoryDetailVO` 里 `categoryName1/2/3` 真机上全是 null，
        // 只有 `lastCategoryName`。而详情响应里有整条
        // `allCategoryPathNameList: ["服饰内衣","男装","男士休闲裤","男士休闲直筒裤"]`。
        //
        // 整条比末级有用：「男士休闲直筒裤」单看不知道是不是童装，而买家问
        // 「这个有儿童款吗」时，AI 需要知道它在哪一支类目下。
        var cat = row.categoryDetailVO || {};
        var path = jdFindKey(root, 'allCategoryPathNameList');
        if (jdIsArray(path) && path.length) {
          add('商品类目', path.join(' > '));
        } else {
          add('商品类目', cat.lastCategoryName || cat.categoryName3);
        }
        // 清单行上那几条（老工程 productAttributes() 取的就是这些）
        add('品牌', row.brandVO && row.brandVO.brandName);
        add('商品货号', row.itemNum);
        add('型号', row.model);
        add('产地', row.placeOfProduction);
        add('UPC', row.upcCode);
        for (var i = 0; i < resolved.attrs.length; i++) { lines.push(resolved.attrs[i]); }

        // SKU 表。**价格以 SKU 为准** —— 真机上清单行的 jdPrice 是 99999
        // （SPU 占位），而两个 SKU 都是 59。把占位价当事实写进知识库，AI 就会
        // 拿它报给买家。
        var skus = bag.skus || [];
        if (skus.length) {
          lines.push('规格与价格：');
          for (var s = 0; s < skus.length; s++) {
            var sk = skus[s];
            var spec = jdSkuSpec(sk);
            var price = (sk.priceDetailVO && sk.priceDetailVO.jdPrice);
            if (price === undefined || price === null) { price = sk.jdPrice; }
            var stock = sk.stockNum;
            var cell = String(spec || '默认规格');
            if (price !== undefined && price !== null && price !== '') { cell += '　价格 ' + price; }
            if (stock !== undefined && stock !== null && stock !== '') { cell += '　库存 ' + stock; }
            if (sk.outerId) { cell += '　编码 ' + sk.outerId; }
            lines.push('  ' + cell);
          }
        }

        // 尺码表。**不是服装专属的写法** —— 这里只问「这个类目的模板里有没有
        // 这一节」，有就读、没有就整段不出现。手机、食品那些类目没有
        // `productSizeTable`，走到这儿就是空数组，一个字都不会多。
        var sizeLines = jdSizeTableLines(pr, jdSizeDict(tp.productSizeTableComponentList || tp));
        if (sizeLines.length) {
          lines.push('尺码表：');
          for (var z = 0; z < sizeLines.length; z++) { lines.push(sizeLines[z]); }
        }

        // 描述：移动端富文本。取纯文字给 AI，图另算。
        var pd = pr.productDesc || {};
        var html = typeof pd.mobileDesc === 'string' ? pd.mobileDesc : '';
        var desc = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

        // 图：主图 + 描述里内嵌的详情图。详情图正是尺码表、成分表所在的地方。
        var imgs = [], imgSeen = {};
        function pushImg(u) {
          if (!u) { return; }
          var full = jdImg(u);
          if (!Object.prototype.hasOwnProperty.call(imgSeen, full)) { imgSeen[full] = 1; imgs.push(full); }
        }
        pushImg(row.logo);
        // SKU 各自的图。**分色的商品上这几张才是买家看到的那几张** ——
        // 主图只有一张，而「蓝色那件长什么样」正是要靠它们回答。
        for (var si = 0; si < skus.length; si++) { pushImg(skus[si].skuImage); }
        var map = pr.imageMap || {};
        for (var mk in map) {
          if (!Object.prototype.hasOwnProperty.call(map, mk)) { continue; }
          var mv = map[mk];
          var list = jdIsArray(mv) ? mv : [mv];
          for (var mi = 0; mi < list.length; mi++) {
            var one = list[mi];
            pushImg(one && typeof one === 'object' ? (one.path || one.url || one.imgUrl || one.image) : one);
          }
        }
        var inDesc = html.match(/(?:https?:)?\/\/[^\s"'<>\\)]+\.(?:jpg|jpeg|png|webp|gif)/gi) || [];
        for (var di = 0; di < inDesc.length; di++) { pushImg(inDesc[di]); }

        return {
          ok: true,
          attrsText: lines.join('\n'),
          desc: desc,
          images: imgs,
          // 下面几条只进日志，用来判断「学到的东西够不够」。
          attrCount: resolved.attrs.length,
          propCount: propCount,
          sizeRows: sizeLines.length,
          skuCount: skus.length,
          unresolved: resolved.unresolved.slice(0, 20),
          skuErr: bag.skuErr || '',
          detailErr: bag.detailErr || '',
          clientPath: jdClientPath
        };
      })
      .then(null, function (e) {
        return { ok: false, reason: (e && e.message) || String(e), clientPath: jdClientPath };
      });
  };

  // ---- 抖店：接口通道 -------------------------------------------------------
  //
  // 与上面京麦那节同一个形状（清单一个 op、详情一个 op，失败都回 `ok: false`
  // 让 Rust 退回读表格那条），差别全在平台。2026-09-12 真机（一件商品，
  // 服装 > 男装 > 休闲裤）验到的事实：
  //
  // - **页面自己的请求层**是 `window['@ecom/swiss-knife/src/ajax']`（老工程
  //   `doudian_shop.js` 也是它），`get` / `post` 都在。签名、令牌它自己带 ——
  //   2026-08-30 探针记录里「抖店清单请求走 Service Worker、页面级包装看不见」
  //   挡的是抓包，不挡这条：我们不抓，我们让它自己发。
  // - 清单 `/product/tproduct/list`，**`pageNum` 从 0 起**，响应
  //   `{code, data: [...], page, size, total}`。
  // - **价格单位是分。** 页面显示 ￥59.00，接口 `price_lower` = 5900。这是抖店版
  //   的「价格坑」——京麦那次是 SPU 上的旧值，这次是单位。不除 100 就是 5900 元。
  // - 属性在 schema（`/product/tproduct/getSchema`）的 `category_properties`：
  //   `items[]` 是这个类目**全部 28 条定义**（面料材质一项就有 153 个候选），
  //   `value` 是这件商品**填了什么**（按属性 id 键，5 条）。**名字只从 items
  //   取、取值只从 value 取** —— 京麦那节讲过为什么，这里的形状一模一样。
  //   老工程用的 pigeon `get_product_properties` 直接给 `{name, value}`，但它
  //   少一条（没有品牌）；留作 schema 失败时的兜底。
  // - 类目路径在 schema 的 `goods_category.value.{first,second,third,fourth}_cname`。
  //   清单行的 `category_name` 也有，但详情那步拿不到清单行（清单接口按 id
  //   过滤会报错），所以从 schema 取。
  // - SKU：pigeon `get_skuinfo_list`，每条 `spec_name1..3` / `spec_detail_name1..3` /
  //   `price`（分）/ `stock_num`。
  // - 描述 `model.description.value` 是 HTML；主图 `model.pic.value[].url`。
  // - 尺码表：schema 只给 `size_info_template_id`（一个模板 id），行数据要再问一次
  //   `/product/tproduct/getComponentTemplateDetail?template_id=…&category_id=…`
  //   （2026-09-13 真机：从清单页直接调得通，不用编辑页、不用 context）。答复里
  //   `component_data` 是一段 JSON **字符串**，`config[尺码][维度] = 值`。按模板 id
  //   缓存 —— 同一家店的裤子多半共用两三张表。
  //
  //   找到这个接口花了十几个探针，教训值得记：`performance.getEntriesByType('resource')`
  //   的缓冲区默认只存 250 条，而这个页面光埋点就打五十几次，缓冲区在尺码组件
  //   发请求之前就满了 —— 于是「没有任何尺码相关请求」是假的。要看全，得在页面
  //   刚起来时 `setResourceTimingBufferSize` 并挂一个 `PerformanceObserver`。
  //
  // # 老工程那份不能照抄的一处
  //
  // 它对一页里所有商品 `Promise.all` **并发**打详情。这里串行 —— 「不封号」
  // 那条原则的第一句就是串行不并发。

  var DY_PIGEON = 'https://pigeon.jinritemai.com'; // gate-allow: 与接口路径同属一份抖店契约（老工程 doudian_shop.js 同一常量）；只把域名挪进配置、路径留在代码里是假的可配置性

  function dyAjax() {
    var a = window['@ecom/swiss-knife/src/ajax'] || window['@ecom/swiss-knife/src/repoch/ajax'];
    return (a && typeof a.get === 'function' && typeof a.post === 'function') ? a : null;
  }

  // 分 → 元。整数就不带小数（「59」），有零头才带（「59.9」）。
  function dyYuan(cents) {
    var n = Number(cents);
    if (!isFinite(n)) { return ''; }
    var y = n / 100;
    return (Math.round(y * 100) === Math.round(y) * 100) ? String(Math.round(y)) : String(Math.round(y * 100) / 100);
  }

  // 清单上那一行显示的价格：SKU 价的区间，两头不一样时给区间。
  // `price_lower` / `price_higher` 与页面显示的是同一个来源（真机 5900 ↔ ￥59.00）。
  function dyListPrice(row) {
    var has = function (v) { return v !== undefined && v !== null && v !== ''; };
    var lo = row.price_lower, hi = row.price_higher;
    if (has(lo) && has(hi)) { return String(lo) === String(hi) ? dyYuan(lo) : (dyYuan(lo) + ' ~ ' + dyYuan(hi)); }
    if (has(lo)) { return dyYuan(lo); }
    if (has(hi)) { return dyYuan(hi); }
    if (has(row.discount_price)) { return dyYuan(row.discount_price); }
    if (has(row.market_price)) { return dyYuan(row.market_price); }
    return '';
  }

  // schema 的 model 里每个字段都是 `{value, label, items, …}` 的壳，取值要剥一层。
  function dyVal(model, key) {
    var f = model && model[key];
    return (f && typeof f === 'object' && Object.prototype.hasOwnProperty.call(f, 'value')) ? f.value : f;
  }

  function dyRowsOf(res) {
    if (jdIsArray(res)) { return res; }
    if (res && jdIsArray(res.data)) { return res.data; }
    return [];
  }

  // 尺码表：把 getComponentTemplateDetail 的答复排成行。
  //
  // 真机形状（2026-09-13）：`data.component_data` 是一段 JSON 字符串
  //   {selected_size:["XS","X"], selected_specs:["身高(cm)","体重(斤)",…],
  //    config:{XS:{"身高(cm)":"160","体重(斤)":"65",…}, X:{…}}}
  // 列的顺序按 `selected_specs`，行的顺序按 `selected_size` —— 与商家在编辑页上
  // 看到的一致。`component_front_data` 是另一份等价的（`configTable:[{size, specMap}]`），
  // 前一份解不出来时用它兜底。
  //
  // 出来是：`  尺码 XS　身高(cm) 160　体重(斤) 65　腰围(cm) 24　臀围(cm) 50　裤长(cm) 130`
  function dySizeLines(data) {
    var lines = [];
    if (!data || typeof data !== 'object') { return lines; }
    var parsed = null;
    try { parsed = typeof data.component_data === 'string' ? JSON.parse(data.component_data) : data.component_data; } catch (_) { parsed = null; }
    if (parsed && parsed.config && typeof parsed.config === 'object') {
      var sizes = (jdIsArray(parsed.selected_size) && parsed.selected_size.length) ? parsed.selected_size : Object.keys(parsed.config);
      var specs = jdIsArray(parsed.selected_specs) ? parsed.selected_specs : [];
      for (var i = 0; i < sizes.length; i++) {
        var sz = sizes[i], row = parsed.config[sz] || {}, cells = ['尺码 ' + sz];
        var order = specs.length ? specs : Object.keys(row);
        for (var s = 0; s < order.length; s++) {
          var v = row[order[s]];
          if (v !== undefined && v !== null && String(v) !== '') { cells.push(order[s] + ' ' + v); }
        }
        if (cells.length > 1) { lines.push('  ' + cells.join('　')); }
      }
      if (lines.length) { return lines; }
    }
    var front = null;
    try { front = typeof data.component_front_data === 'string' ? JSON.parse(data.component_front_data) : data.component_front_data; } catch (_) { front = null; }
    var table = (front && jdIsArray(front.configTable)) ? front.configTable : [];
    for (var t = 0; t < table.length; t++) {
      var it = table[t] || {}, map = it.specMap || {}, cs = ['尺码 ' + (it.size || '')];
      for (var k in map) {
        if (Object.prototype.hasOwnProperty.call(map, k) && String(map[k]) !== '') { cs.push(k + ' ' + map[k]); }
      }
      if (cs.length > 1) { lines.push('  ' + cs.join('　')); }
    }
    return lines;
  }

  // 尺码模板按 id 缓存，活在这个文档里。一次采集是几分钟的事，而模板内容只在
  // 商家编辑它时才变 —— 200 件裤子共用三张表，就只打三次。
  var dyTplCache = {};

  // 读商品清单。只发清单请求；详情按需，见 `dyApiDetail`。
  ops.dyApiList = function (args) {
    var a = args || {};
    var pageSize = Number(a.pageSize) > 0 ? Number(a.pageSize) : 50;
    var maxPages = Number(a.maxPages) > 0 ? Math.min(Number(a.maxPages), 100) : 100;
    var pageDelay = Number(a.pageDelay) >= 0 ? Number(a.pageDelay) : 400;
    var ajax = dyAjax();
    if (!ajax) {
      return Promise.resolve({ ok: false, reason: '页面里没有 @ecom/swiss-knife 的 ajax 模块 —— 页面可能还没加载完，或已改版', items: [] });
    }
    var items = [], seen = {}, pages = 0, declared = 0, statusCounts = {};

    function step(n) {
      if (n >= maxPages) { return Promise.resolve(); }
      return ajax.post('/product/tproduct/list', { pageNum: n, pageSize: pageSize }).then(function (res) {
        pages += 1;
        if (n === 0) { declared = Number(res && res.total) || 0; }
        var rows = dyRowsOf(res);
        var fresh = 0;
        for (var i = 0; i < rows.length; i++) {
          var p = rows[i] || {};
          var id = String(p.product_id || '');
          var title = String(p.name || '');
          if (title === '') { continue; }
          var key = id !== '' ? id : title;
          if (Object.prototype.hasOwnProperty.call(seen, key)) { continue; }
          seen[key] = 1;
          fresh += 1;
          // `status` 只统计不过滤 —— 与闲鱼那条同一个纪律：真机只见过一个取值
          // （0），拿一个样本去推断「别的值都是下架」然后据此丢商品，是在用猜测
          // 做不可见的删除。分布带回 Rust 进日志。
          var sk = (p.status === undefined || p.status === null) ? 'null' : String(p.status);
          statusCounts[sk] = (statusCounts[sk] || 0) + 1;
          items.push({
            title: title,
            itemId: id,
            price: dyListPrice(p),
            thumb: String(p.img || ''),
            alias: '',
            images: p.img ? [String(p.img)] : [],
            itemHref: String(p.product_url || ''),
            itemStatus: (typeof p.status === 'number') ? p.status : null
          });
        }
        if (fresh === 0) { return; }
        if (rows.length < pageSize) { return; }
        return jdSleep(pageDelay).then(function () { return step(n + 1); });
      });
    }

    return step(0).then(function () {
      return { ok: true, items: items, pages: pages, declared: declared, statusCounts: statusCounts, clientPath: 'swiss-knife/ajax' };
    }, function (e) {
      var msg = (e && e.message) || (e && e.msg) || String(e);
      return { ok: false, reason: msg, clientPath: 'swiss-knife/ajax', items: [] };
    });
  };

  // 属性：名字只从 items 取，取值只从 value 取。
  function dyResolveProps(cp) {
    var out = [], unresolved = [], propCount = 0;
    if (!cp || typeof cp !== 'object') { return { attrs: out, unresolved: unresolved, propCount: 0 }; }
    var labelOf = {};
    var items = jdIsArray(cp.items) ? cp.items : [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {};
      if (it.id !== undefined && it.id !== null && typeof it.label === 'string' && it.label !== '') {
        labelOf[String(it.id)] = it.label;
      }
    }
    var value = (cp.value && typeof cp.value === 'object') ? cp.value : {};
    for (var pid in value) {
      if (!Object.prototype.hasOwnProperty.call(value, pid)) { continue; }
      propCount++;
      var vals = jdIsArray(value[pid]) ? value[pid] : [value[pid]];
      var names = [];
      for (var v = 0; v < vals.length; v++) {
        var one = vals[v];
        var nm = one && typeof one === 'object' ? one.value_name : one;
        if (nm !== undefined && nm !== null && String(nm) !== '') { names.push(String(nm)); }
      }
      var label = labelOf[pid];
      if (!label) { unresolved.push('名字?' + pid); label = '属性' + pid; }
      if (names.length) { out.push(label + ': ' + names.join('、')); }
    }
    return { attrs: out, unresolved: unresolved, propCount: propCount };
  }

  // 读一件商品的学习素材。三次请求，串行：schema → SKU →（schema 里没属性时）属性接口。
  ops.dyApiDetail = function (args) {
    var a = args || {};
    var productId = String(a.productId || '').trim();
    if (productId === '') { return Promise.resolve({ ok: false, reason: '没有给出商品 id' }); }
    var itemDelay = Number(a.itemDelay) >= 0 ? Number(a.itemDelay) : 250;
    var ajax = dyAjax();
    if (!ajax) { return Promise.resolve({ ok: false, reason: '页面里没有 @ecom/swiss-knife 的 ajax 模块' }); }

    var model = null, schemaCtx = null, detailErr = '';
    return ajax.get('/product/tproduct/getSchema', { product_id: productId })
      .then(function (r) {
        model = (r && r.data && r.data.model) || null;
        schemaCtx = (r && r.data && r.data.context) || null;
        if (!model) { detailErr = 'schema 没有 model'; }
      }, function (e) {
        detailErr = (e && e.message) || (e && e.msg) || String(e);
      })
      .then(function () { return jdSleep(itemDelay); })
      .then(function () {
        return ajax.get(DY_PIGEON + '/backstage/workstation/get_skuinfo_list', { product_id: productId, PIGEON_BIZ_TYPE: 2 })
          .then(function (r) {
            var items = (r && r.data && jdIsArray(r.data.items)) ? r.data.items : (jdIsArray(r && r.items) ? r.items : []);
            return { skus: items, skuErr: '' };
          }, function (e) {
            return { skus: [], skuErr: (e && e.message) || (e && e.msg) || String(e) };
          });
      })
      .then(function (bag) {
        var resolved = dyResolveProps(model && model.category_properties);
        // schema 那条没拿到属性时，退到老工程用的属性接口。它少一条（没有品牌），
        // 但有总比没有强。
        if (resolved.attrs.length === 0) {
          return jdSleep(itemDelay).then(function () {
            return ajax.get(DY_PIGEON + '/backstage/workstation/get_product_properties', { product_id: productId, PIGEON_BIZ_TYPE: 2 })
              .then(function (r) {
                var props = (r && r.data && jdIsArray(r.data.properties)) ? r.data.properties : [];
                for (var i = 0; i < props.length; i++) {
                  var x = props[i] || {};
                  if (x.name && x.value !== undefined && x.value !== null && x.value !== '') {
                    resolved.attrs.push(String(x.name) + ': ' + String(x.value));
                  }
                }
                if (resolved.propCount === 0) { resolved.propCount = props.length; }
                bag.resolved = resolved; bag.propsFallback = true;
                return bag;
              }, function () { bag.resolved = resolved; bag.propsFallback = true; return bag; });
          });
        }
        bag.resolved = resolved; bag.propsFallback = false;
        return bag;
      })
      .then(function (bag) {
        // 尺码表。没有模板 id 的类目（数码、食品）这一步整段跳过，一个请求都不发。
        var m = model || {};
        var tid = dyVal(m, 'size_info_template_id');
        tid = (tid === undefined || tid === null) ? '' : String(tid).trim();
        bag.sizeLines = []; bag.sizeImage = ''; bag.sizeErr = '';
        if (tid === '' || tid === '0') { return bag; }
        var gc = dyVal(m, 'goods_category') || {};
        var cid = (schemaCtx && schemaCtx.category_id) || gc.category_leaf_id || '';
        var take = function (data) {
          bag.sizeLines = dySizeLines(data);
          bag.sizeImage = (data && data.image && data.image.url) ? String(data.image.url) : '';
          return bag;
        };
        if (Object.prototype.hasOwnProperty.call(dyTplCache, tid)) { return take(dyTplCache[tid]); }
        return jdSleep(itemDelay).then(function () {
          return ajax.get('/product/tproduct/getComponentTemplateDetail', { template_id: tid, category_id: cid, is_std_size_name: false })
            .then(function (r) {
              var data = r && r.data;
              if (data && typeof data === 'object') { dyTplCache[tid] = data; }
              return take(data);
            }, function (e) {
              // 尺码表拿不到不算整件失败：属性、SKU、描述照收。
              bag.sizeErr = (e && e.message) || (e && e.msg) || String(e);
              return bag;
            });
        });
      })
      .then(function (bag) {
        var m = model || {};
        var resolved = bag.resolved;
        var lines = [];
        function add(name, value) {
          if (value === undefined || value === null || value === '') { return; }
          lines.push(name + ': ' + value);
        }
        // 完整类目路径。四级，空的跳过。
        var gc = dyVal(m, 'goods_category') || {};
        var path = [];
        var levels = ['first_cname', 'second_cname', 'third_cname', 'fourth_cname'];
        for (var l = 0; l < levels.length; l++) {
          var nm = gc[levels[l]];
          if (typeof nm === 'string' && nm.trim() !== '') { path.push(nm.trim()); }
        }
        if (path.length) { add('商品类目', path.join(' > ')); }
        for (var i = 0; i < resolved.attrs.length; i++) { lines.push(resolved.attrs[i]); }

        // SKU 表。规格 = 各维度「维度名 取值」拼起来（真机：颜色分类 浅灰色 / 尺码大小 6XS）。
        // **价格以分计**，这里除 100。
        var skus = bag.skus || [];
        if (skus.length) {
          lines.push('规格与价格：');
          for (var s = 0; s < skus.length; s++) {
            var sk = skus[s] || {};
            var parts = [];
            for (var d = 1; d <= 3; d++) {
              var dn = sk['spec_name' + d], dv = sk['spec_detail_name' + d];
              if (dv !== undefined && dv !== null && String(dv) !== '') {
                parts.push((dn ? (String(dn) + ' ') : '') + String(dv));
              }
            }
            var cell = parts.length ? parts.join('　') : '默认规格';
            var price = (sk.price !== undefined && sk.price !== null && sk.price !== '') ? dyYuan(sk.price) : '';
            if (price !== '') { cell += '　价格 ' + price; }
            if (sk.stock_num !== undefined && sk.stock_num !== null && sk.stock_num !== '') { cell += '　库存 ' + sk.stock_num; }
            if (sk.purchase_status === false) { cell += '　（已下线）'; }
            lines.push('  ' + cell);
          }
        }

        if (bag.sizeLines && bag.sizeLines.length) {
          lines.push('尺码表：');
          for (var z = 0; z < bag.sizeLines.length; z++) { lines.push(bag.sizeLines[z]); }
        }

        // 描述与图。
        var html = dyVal(m, 'description');
        if (typeof html !== 'string') { html = ''; }
        var desc = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        var imgs = [], seen = {};
        function pushImg(u) {
          if (!u || typeof u !== 'string') { return; }
          var full = u.indexOf('//') === 0 ? 'https:' + u : u;
          if (!Object.prototype.hasOwnProperty.call(seen, full)) { seen[full] = 1; imgs.push(full); }
        }
        var pics = dyVal(m, 'pic');
        if (jdIsArray(pics)) {
          for (var pi = 0; pi < pics.length; pi++) {
            var one = pics[pi];
            pushImg(one && typeof one === 'object' ? (one.url || one.uri) : one);
          }
        }
        // 尺码图。多模态那一步看得懂它，而买家问「我 175 穿什么码」时它就是答案。
        pushImg(bag.sizeImage);
        var inDesc = html.match(/(?:https?:)?\/\/[^\s"'<>\\)]+/g) || [];
        for (var di = 0; di < inDesc.length; di++) {
          var u = inDesc[di];
          // 抖店的图地址常常没有扩展名（`.../png_m_xxx_www2000-2000`），按域名认。
          if (/\.(jpg|jpeg|png|webp|gif|bmp|avif)(\?|$)/i.test(u) || /ecombdimg|byteimg|douyinpic|pstatp|douyinstatic|tos-cn|ecom-shop-material/i.test(u)) {
            pushImg(u);
          }
        }

        var titleV = dyVal(m, 'title');
        return {
          ok: true,
          attrsText: lines.join('\n'),
          desc: desc,
          images: imgs,
          attrCount: resolved.attrs.length,
          propCount: resolved.propCount,
          sizeRows: (bag.sizeLines || []).length,
          sizeErr: bag.sizeErr || '',
          skuCount: skus.length,
          unresolved: resolved.unresolved.slice(0, 20),
          skuErr: bag.skuErr || '',
          detailErr: detailErr,
          propsFallback: !!bag.propsFallback,
          title: typeof titleV === 'string' ? titleV : '',
          clientPath: 'swiss-knife/ajax'
        };
      })
      .then(null, function (e) {
        return { ok: false, reason: (e && e.message) || (e && e.msg) || String(e), clientPath: 'swiss-knife/ajax' };
      });
  };

  // ---- 千牛（淘宝卖家中心）：接口通道 ------------------------------------------
  //
  // 与京麦/抖店同一个形状。请求层是页面自己的 `window.lib.mtop`（`mtopClient()`，
  // 闲鱼的快速通道用的也是它）—— 签名、`_m_h5_tk` 令牌全由它算。
  //
  // # 清单用卖家中心页面自己的接口，不用老工程那个
  //
  // 老工程 `qinniu_shop.js` 用 `mtop.taobao.qianniu.cs.item.onsale.query`。2026-09-13
  // 真机：它回 5 件、页面「共4件」—— 多出来那件图名带 `xy_item`，是同一个淘宝号下
  // **闲鱼**的货（`cs` = 客服视角，跨了平台）。照抄它会把闲鱼货存进千牛店的知识库。
  //
  // 卖家中心页面自己拉表格用的是 `mtop.taobao.sell.pc.manage.async`（POST），
  // body `{url:'/taobao/manager/table.htm', jsonBody:'{tab, pagination, filter…}'}`，
  // 4 件与页面一致。`optType=queryTabNum` 那个给各页签件数，拿它当对账真相。
  // 响应 `data.result` 是**双重编码**的 JSON 字符串，要再 parse 一次。
  //
  // # 详情：接口先试，拿不到属性就退回买家页 DOM
  //
  // `mtop.taobao.pcdetail.data.get`（买家侧公开接口，老工程用的）给标题、主图、
  // SKU 维度与价格；属性在响应里的位置按老工程 `parseAttributes` 那组键名找。
  // **这家测试店的商品本来就没有属性和 SKU**（买家页上也没有），所以属性解析在
  // 真机上还没验过 —— 于是 Rust 侧：接口解出 0 条属性就走原来那条买家页 DOM
  // （2026-08-28 在一件 Dickies 裤子上验过 15 组属性、4 行尺码）。买家侧数据没有
  // 「候选」这回事，盲扫在这里是安全的。
  //
  // # 节流
  //
  // 老工程注释「千牛 mtop 必须限流，不用并发池」，`itemDelay` 1500。卖家中心是卖家
  // 自己的后台，被盯上的代价比买家侧重，照它。

  function qnRequest(client, api, data, v, type, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = later(function () {
        if (!done) { done = true; reject(new Error(api + ' 超时（' + (timeoutMs || 15000) + 'ms）—— 闲鱼那边的经验：登录过期后 mtop 不报错、卡成假超时')); }
      }, timeoutMs || 15000);
      try {
        var ret = client.request({ api: api, v: v || '1.0', data: data || {}, type: (type || 'GET').toUpperCase(), dataType: 'json', timeout: timeoutMs || 15000 },
          function (r) { if (!done) { done = true; qnClear(timer); resolve(r); } },
          function (e) { if (!done) { done = true; qnClear(timer); reject(e); } });
        if (ret && typeof ret.then === 'function') {
          ret.then(function (r) { if (!done) { done = true; qnClear(timer); resolve(r); } },
                   function (e) { if (!done) { done = true; qnClear(timer); reject(e); } });
        }
      } catch (e) { if (!done) { done = true; qnClear(timer); reject(e); } }
    });
  }

  // 桥的 NATIVE 只备份了 setTimeout/setInterval/clearInterval，没有 clearTimeout ——
  // 直接 .call 一个 undefined 会在成功回调里抛错，而那时 done 已置真，promise 就挂死了
  // （2026-09-13 两个 op 各超时 30 秒，就是它）。
  function qnClear(t) { var c = NATIVE.clearTimeout || window.clearTimeout; if (typeof c === "function") { c.call(window, t); } }

  function qnErr(e) {
    if (!e) { return '未知错误'; }
    if (e.message) { return String(e.message); }
    if (jdIsArray(e.ret) && e.ret.length) { return String(e.ret[0]); }
    try { return JSON.stringify(e).slice(0, 200); } catch (_) { return String(e); }
  }

  function qnOk(r) { return r && jdIsArray(r.ret) && /^SUCCESS/.test(String(r.ret[0] || '')); }

  // `data.result` 是双重编码的 JSON 字符串。
  function qnInner(r) {
    var d = r && r.data;
    if (!d) { return null; }
    if (typeof d.result === 'string') { try { return JSON.parse(d.result); } catch (_) { return null; } }
    return d;
  }

  // 「¥ 1465.00」→「1465.00」；「¥ 59.00-99.00」原样留区间。
  function qnPrice(v) {
    if (v === undefined || v === null) { return ''; }
    return String(v).replace(/[¥￥]/g, '').replace(/\s+/g, '').trim();
  }

  function qnAbs(u) {
    if (!u) { return ''; }
    u = String(u);
    return u.indexOf('//') === 0 ? 'https:' + u : u;
  }

  // 卖家中心表格的一行 → 商品摘要。真机形状（2026-09-13）：
  //   itemId, catId, itemDesc:{img, imgLink:{href}, desc:[{uiType:'link', text:标题, href}, {text:'ID:…'}, {text:' 编码:d04'}]},
  //   managerPrice:{currentPrice:'¥ 1465.00'}, managerQuantityNew:{text:100}
  function qnBriefOf(row) {
    var d = row.itemDesc || {};
    var title = '';
    var descs = jdIsArray(d.desc) ? d.desc : [];
    for (var i = 0; i < descs.length; i++) {
      var x = descs[i] || {};
      if (x.uiType === 'link' && typeof x.text === 'string' && x.text.trim() !== '') { title = x.text.trim(); break; }
    }
    if (title === '') { for (var j = 0; j < descs.length; j++) { var y = descs[j] || {}; if (typeof y.text === 'string' && !/^ID:|编码:/.test(y.text.trim()) && y.text.trim() !== '') { title = y.text.trim(); break; } } }
    var href = (d.imgLink && d.imgLink.href) || '';
    if (!href) { for (var k = 0; k < descs.length; k++) { if (descs[k] && descs[k].href) { href = descs[k].href; break; } } }
    var thumb = qnAbs(d.img);
    return {
      title: title,
      itemId: String(row.itemId || ''),
      price: qnPrice(row.managerPrice && row.managerPrice.currentPrice),
      thumb: thumb,
      alias: '',
      images: thumb ? [thumb] : [],
      // **用行里那个链接的真实地址**：天猫商品在 detail.tmall.com，拼前缀会拼错域。
      itemHref: String(href || ''),
      itemStatus: null
    };
  }

  ops.qnApiList = function (args) {
    var a = args || {};
    var pageSize = Number(a.pageSize) > 0 ? Number(a.pageSize) : 20;
    var maxPages = Number(a.maxPages) > 0 ? Math.min(Number(a.maxPages), 100) : 50;
    var pageDelay = Number(a.pageDelay) >= 0 ? Number(a.pageDelay) : 1500;
    var tab = String(a.tab || 'on_sale');
    var client = mtopClient();
    if (!client) { return Promise.resolve({ ok: false, reason: '页面里没有可用的 mtop 客户端 —— 页面可能还没加载完，或已改版', items: [] }); }
    var items = [], seen = {}, pages = 0, declared = 0, tabNum = null;

    function page(n) {
      return qnRequest(client, 'mtop.taobao.sell.pc.manage.async', {
        url: '/taobao/manager/table.htm',
        jsonBody: JSON.stringify({ tab: tab, pagination: { current: n, pageSize: pageSize }, filtertab: '', filter: {}, table: {} })
      }, '1.0', 'POST');
    }
    function step(n) {
      if (n > maxPages) { return Promise.resolve(); }
      return page(n).then(function (r) {
        if (!qnOk(r)) { throw new Error('清单接口没成：' + qnErr(r)); }
        var inner = qnInner(r);
        if (!inner || !inner.data) { throw new Error('清单接口的 result 看不懂'); }
        pages += 1;
        var tbl = inner.data.table || {};
        var rows = jdIsArray(tbl.dataSource) ? tbl.dataSource : [];
        var pg = inner.data.pagination || {};
        if (n === 1) { declared = Number(pg.total) || 0; }
        var fresh = 0;
        for (var i = 0; i < rows.length; i++) {
          var b = qnBriefOf(rows[i] || {});
          if (b.title === '') { continue; }
          var key = b.itemId !== '' ? b.itemId : b.title;
          if (Object.prototype.hasOwnProperty.call(seen, key)) { continue; }
          seen[key] = 1; fresh += 1; items.push(b);
        }
        if (fresh === 0) { return; }
        if (rows.length < pageSize) { return; }
        if (declared > 0 && items.length >= declared) { return; }
        return jdSleep(pageDelay).then(function () { return step(n + 1); });
      });
    }

    // 先问各页签件数（对账真相），失败不影响清单。
    return qnRequest(client, 'mtop.taobao.sell.pc.manage.async', { url: '/taobao/manager/async.htm?optType=queryTabNum', jsonBody: JSON.stringify({ tab: tab }) }, '1.0', 'POST')
      .then(function (r) { var inner = qnInner(r); tabNum = inner && inner.data ? inner.data : null; }, function () { tabNum = null; })
      .then(function () { return jdSleep(Math.min(pageDelay, 600)); })
      .then(function () { return step(1); })
      .then(function () {
        var expected = tabNum && Number(tabNum[tab]) > 0 ? Number(tabNum[tab]) : declared;
        return { ok: true, items: items, pages: pages, declared: expected, tabNum: tabNum, clientPath: 'lib.mtop' };
      }, function (e) {
        return { ok: false, reason: qnErr(e), clientPath: 'lib.mtop', items: [] };
      });
  };

  // 老工程 `parseAttributes` 的移植：在买家侧详情响应里按这组键名找属性。
  // 买家侧数据没有「候选表」，盲扫在这里是安全的（与京麦/抖店那两处的
  // template 不同）。找不到就是 0 条，由 Rust 退回买家页 DOM。
  function qnParseAttributes(detail) {
    var out = [], seen = {};
    function add(name, value) {
      if (!name || value === undefined || value === null || value === '') { return; }
      if (jdIsArray(value)) {
        var parts = [];
        for (var i = 0; i < value.length; i++) { var x = value[i]; parts.push(x && typeof x === 'object' ? (x.name || x.value || x.valueName || '') : String(x)); }
        value = parts.filter(function (p) { return p !== ''; }).join('、');
      }
      if (typeof value === 'object') { return; }
      var line = String(name).trim() + ': ' + String(value).trim();
      if (!seen[line]) { seen[line] = 1; out.push(line); }
    }
    function parseJson(v) {
      if (typeof v !== 'string') { return v; }
      var t = v.trim();
      if (!t || (t.charAt(0) !== '{' && t.charAt(0) !== '[')) { return v; }
      try { return JSON.parse(t); } catch (_) { return v; }
    }
    function parseGroups(groups) {
      if (groups && !jdIsArray(groups) && typeof groups === 'object') { groups = [groups]; }
      groups = jdIsArray(groups) ? groups : [];
      for (var g = 0; g < groups.length; g++) {
        var group = groups[g];
        if (!group || typeof group !== 'object') { continue; }
        var gn = group.name || group.attrName || group.propertyName;
        var gv = group.value !== undefined ? group.value : (group.attrValue !== undefined ? group.attrValue : group.propertyValue);
        if (gn && gv !== undefined) { add(gn, gv); }
        var ks = Object.keys(group);
        for (var k = 0; k < ks.length; k++) {
          var vals = group[ks[k]];
          if (!jdIsArray(vals)) { continue; }
          for (var p = 0; p < vals.length; p++) {
            var prop = vals[p];
            if (!prop || typeof prop !== 'object') { continue; }
            var pn = prop.name || prop.attrName || prop.propertyName || prop.key;
            var pv = prop.value !== undefined ? prop.value : (prop.attrValue !== undefined ? prop.attrValue : (prop.propertyValue !== undefined ? prop.propertyValue : prop.values));
            if (pn && pv !== undefined) { add(pn, pv); }
            else { var pk = Object.keys(prop); for (var q = 0; q < pk.length; q++) { add(pk[q], prop[pk[q]]); } }
          }
        }
      }
    }
    var GROUP_KEYS = ['groupProps', 'group_props', 'itemProperties', 'basicProps'];
    var LIST_KEYS = ['properties', 'itemProps', 'attributes', 'propsList', 'propertyList', 'productProps', 'enhanceParamList', 'basicParamList'];
    var visited = [];
    function walk(value, key, depth) {
      value = parseJson(value);
      if (!value || typeof value !== 'object' || depth > 9 || visited.indexOf(value) >= 0) { return; }
      visited.push(value);
      if (jdIsArray(value)) {
        if (GROUP_KEYS.indexOf(key) >= 0) { parseGroups(value); }
        if (LIST_KEYS.indexOf(key) >= 0) {
          for (var i = 0; i < value.length; i++) {
            var prop = value[i];
            if (!prop || typeof prop !== 'object') { continue; }
            add(prop.propertyName || prop.name || prop.key || prop.attrName || prop.property_name || prop.pname,
                prop.valueName !== undefined ? prop.valueName : (prop.value !== undefined ? prop.value : (prop.values !== undefined ? prop.values : (prop.attrValue !== undefined ? prop.attrValue : (prop.propertyValue !== undefined ? prop.propertyValue : (prop.property_value !== undefined ? prop.property_value : prop.value_name))))));
          }
        }
        for (var c = 0; c < value.length; c++) { walk(value[c], key, depth + 1); }
        return;
      }
      if ((key === 'groupProps' || key === 'group_props') && typeof value === 'object') { parseGroups(value); }
      var keys = Object.keys(value);
      for (var kk = 0; kk < keys.length; kk++) { walk(value[keys[kk]], keys[kk], depth + 1); }
    }
    walk(detail, '', 0);
    return out;
  }

  // `getdesc` 的图文详情。**按它自己的结构取，不做全树捞**
  // （2026-09-13 真机确认的形状）：
  //
  //   components.layout      = [{ID:'detail_pic_…_1_1', key:'desc_single_image'}, …]  ← 商家排的顺序
  //   components.componentData[ID].model.picUrl = '//img.alicdn.com/…'
  //   components.componentData[ID].model.text   = '一段文字'
  //
  // 全树捞 alicdn 字符串也能捞到图，但顺序是对象键的顺序、还会把平台自己的
  // 图标一起捞进来 —— 而图是要喂给多模态的，多模态有张数上限，捞错的位置
  // 就是尺码表的位置。
  function qnDescParts(data) {
    var out = { images: [], texts: [] };
    var comp = (data && data.components) || {};
    var cd = comp.componentData || {};
    var seen = {};
    function take(id) {
      var one = cd[id];
      var model = (one && one.model) || null;
      if (!model) { return; }
      var u = model.picUrl;
      if (typeof u === 'string' && u !== '') {
        // 平台自己塞的促销条（`detail_pic_tmallPriceDesc_*`）不是商家的商品
        // 信息。认错了也只是多一张图，不影响别的。
        if (String(id).indexOf('detail_pic_tmall') !== 0 && !Object.prototype.hasOwnProperty.call(seen, u)) {
          seen[u] = 1; out.images.push(u);
        }
      }
      var t = model.text;
      if (typeof t === 'string' && t.trim() !== '') { out.texts.push(t.trim()); }
    }
    var layout = jdIsArray(comp.layout) ? comp.layout : [];
    if (layout.length) {
      for (var i = 0; i < layout.length; i++) { var l = layout[i]; if (l && l.ID) { take(String(l.ID)); } }
    } else {
      var ks = Object.keys(cd);
      for (var k = 0; k < ks.length; k++) { take(ks[k]); }
    }
    return out;
  }

  // 尺码表。**在 pcdetail 里，不用开买家页**（2026-09-13 真机，真维斯休闲裤
  // 818241350170）：`skuBase.props[].values[].sizeDescList` = `[{key:'适合腰围',
  // value:'64.0cm'}, …]`，一个尺码一行。表头由 key 给 —— 不写死任何品类字段。
  function qnSizeLines(detail) {
    var skuBase = (detail && detail.skuBase) || {};
    var props = jdIsArray(skuBase.props) ? skuBase.props : [];
    var lines = [], rows = 0;
    for (var p = 0; p < props.length; p++) {
      var prop = props[p] || {};
      var vals = jdIsArray(prop.values) ? prop.values : [];
      var header = [], seen = {};
      for (var v = 0; v < vals.length; v++) {
        var dl = jdIsArray(vals[v] && vals[v].sizeDescList) ? vals[v].sizeDescList : [];
        for (var k = 0; k < dl.length; k++) {
          var key = dl[k] && dl[k].key;
          if (key && !Object.prototype.hasOwnProperty.call(seen, String(key))) { seen[String(key)] = 1; header.push(String(key)); }
        }
      }
      if (header.length === 0) { continue; }
      lines.push('  ' + (prop.name ? String(prop.name) : '尺码') + '　' + header.join('　'));
      for (var v2 = 0; v2 < vals.length; v2++) {
        var val = vals[v2] || {};
        var dl2 = jdIsArray(val.sizeDescList) ? val.sizeDescList : [];
        if (dl2.length === 0) { continue; }
        var byKey = {};
        for (var k2 = 0; k2 < dl2.length; k2++) { var one = dl2[k2] || {}; if (one.key) { byKey[String(one.key)] = one.value === undefined || one.value === null ? '' : String(one.value); } }
        var cells = [String(val.name || val.value || '')];
        for (var h = 0; h < header.length; h++) { cells.push(byKey[header[h]] || ''); }
        lines.push('  ' + cells.join('　'));
        rows++;
      }
    }
    return { lines: lines, rows: rows };
  }

  // 单规格商品的价格与库存。**多规格走 qnPublicSkus，这条只管没有规格维度的**
  // （`skuBase.skus` 空、`sku2info` 只有一个 `"0"`）：2026-09-13 真机上四件
  // 虚拟商品都是这一类，此前价格和库存**一条都没进过学习素材**。
  function qnSingleSku(detail) {
    var core = (detail && detail.skuCore) || {};
    var info = core.sku2info || {};
    var one = info['0'];
    if (!one || typeof one !== 'object') { return ''; }
    var cell = '默认规格';
    var price = one.price || {};
    var text = price.priceText;
    if ((text === undefined || text === null || text === '') && price.priceMoney !== undefined) {
      var n = Number(price.priceMoney);
      if (isFinite(n)) { text = String(Math.round(n) / 100); }
    }
    if (text !== undefined && text !== null && String(text) !== '') { cell += '　价格 ' + String(text); }
    var q = one.quantity !== undefined ? one.quantity : one.quantityDisplayValue;
    if (q !== undefined && q !== null && String(q) !== '') { cell += '　库存 ' + String(q); }
    return cell === '默认规格' ? '' : cell;
  }

  // pcdetail 的 SKU：skuBase.props 给维度和取值名，skuCore.sku2info 给价格/库存。
  function qnPublicSkus(detail) {
    var skuBase = (detail && detail.skuBase) || {};
    var skuCore = (detail && detail.skuCore) || {};
    var valueMap = {};
    var props = jdIsArray(skuBase.props) ? skuBase.props : [];
    for (var p = 0; p < props.length; p++) {
      var prop = props[p] || {}; var vals = jdIsArray(prop.values) ? prop.values : [];
      for (var v = 0; v < vals.length; v++) {
        var val = vals[v] || {};
        valueMap[String(prop.pid) + ':' + String(val.vid)] = (prop.name ? prop.name + ' ' : '') + (val.name || val.value || val.vid);
      }
    }
    var sku2info = skuCore.sku2info || {};
    var skus = jdIsArray(skuBase.skus) ? skuBase.skus : [];
    var out = [];
    for (var s = 0; s < skus.length; s++) {
      var sku = skus[s] || {};
      var id = String(sku.skuId || sku.sku_id || '');
      var info = sku2info[id] || {};
      var priceInfo = info.price || {};
      var path = String(sku.propPath || sku.prop_path || '');
      var names = [];
      var segs = path.split(';');
      for (var g = 0; g < segs.length; g++) { if (segs[g]) { names.push(valueMap[segs[g]] || segs[g]); } }
      var price = priceInfo.priceText || priceInfo.price || info.priceText || '';
      var stock = info.quantity !== undefined ? info.quantity : sku.quantity;
      out.push({ spec: names.join('　') || sku.skuName || '', price: price, stock: stock, skuId: id });
    }
    return out;
  }

  ops.qnApiDetail = function (args) {
    var a = args || {};
    var itemId = String(a.itemId || a.productId || '').trim();
    if (itemId === '') { return Promise.resolve({ ok: false, reason: '没有给出商品 id' }); }
    var itemDelay = Number(a.itemDelay) >= 0 ? Number(a.itemDelay) : 1500;
    var descApi = String(a.descApi || 'mtop.taobao.detail.getdesc');
    var descV = String(a.descV || '7.0');
    var descTtid = String(a.descTtid || '');
    var client = mtopClient();
    if (!client) { return Promise.resolve({ ok: false, reason: '页面里没有可用的 mtop 客户端' }); }

    var detail = null, detailErr = '';
    var exParams = JSON.stringify({ id: itemId, queryParams: 'id=' + itemId, domain: 'https://item.taobao.com', path_name: '/item.htm' }); // gate-allow: pcdetail 接口要求的入参（exParams.domain），与接口名同属一份 mtop 契约，老工程原样传的就是它
    return qnRequest(client, 'mtop.taobao.pcdetail.data.get', { id: itemId, detail_v: '3.3.2', exParams: exParams }, '1.0', 'GET')
      .then(function (r) {
        if (!qnOk(r)) { detailErr = qnErr(r); return; }
        detail = (r && r.data) || null;
      }, function (e) { detailErr = qnErr(e); })
      .then(function () { return jdSleep(itemDelay); })
      .then(function () {
        // 卖家侧 SKU：外部编码和库存只有它给。失败不算整件失败。
        return qnRequest(client, 'mtop.taobao.item.sku.get', { itemId: Number(itemId) }, '1.0', 'GET')
          .then(function (r) {
            var d = (r && r.data) || {};
            var list = (jdIsArray(d.pageResult) && d.pageResult[0] && jdIsArray(d.pageResult[0].skuList)) ? d.pageResult[0].skuList : [];
            return { sellerSkus: list, skuErr: qnOk(r) ? '' : qnErr(r) };
          }, function (e) { return { sellerSkus: [], skuErr: qnErr(e) }; });
      })
      .then(function (bag) {
        // 图文详情：详情图 + 描述正文。**ttid 是这个接口通不通的唯一开关**
        // （2026-09-13 真机：给了就 SUCCESS，不给一律
        // `FAIL_SYS_SERVICE_INNER_FAULT` —— 画像里那句「反爬挡着、四种组合全
        // 失败」是 2026-08-28 的结论，已经过期）。
        //
        // 这一步拿到之后，**买家页那条路就不必走了**：商家把信息全放在详情图
        // 里的那种店（虚拟商品、卡密），买家页滚十秒读回来的就是这几张图。
        var opt = {
          api: descApi, v: descV,
          data: { id: itemId, detail_v: '3.3.0', preferWireless: 'true' },
          type: 'GET', dataType: 'jsonp', timeout: 15000,
          AntiFlood: true, AntiCreep: true
        };
        if (descTtid !== '') { opt.ttid = descTtid; }
        return new Promise(function (resolve) {
          var done = false;
          var timer = later(function () { if (!done) { done = true; resolve({ descImgs: [], texts: [], descErr: descApi + ' 超时' }); } }, 15000);
          function ok(r) {
            if (done) { return; }
            done = true; qnClear(timer);
            var got = { images: [], texts: [] };
            try { got = qnDescParts(r && r.data); } catch (e) { /* 形状变了就当空 */ }
            resolve({ descImgs: got.images, texts: got.texts, descErr: qnOk(r) ? '' : qnErr(r) });
          }
          function bad(e) { if (!done) { done = true; qnClear(timer); resolve({ descImgs: [], texts: [], descErr: qnErr(e) }); } }
          try {
            var ret = client.request(opt, ok, bad);
            if (ret && typeof ret.then === 'function') { ret.then(ok, bad); }
          } catch (e) { bad(e); }
        }).then(function (dsc) {
          bag.descImgs = dsc.descImgs; bag.texts = dsc.texts; bag.descErr = dsc.descErr;
          return bag;
        });
      })
      .then(function (bag) {
        var d = detail || {};
        var item = d.item || {};
        var attrs = qnParseAttributes({ pcDetail: d });
        var lines = [];
        var cat = item.categoryName || d.categoryName || '';
        if (cat) { lines.push('商品类目: ' + cat); }
        for (var i = 0; i < attrs.length; i++) { lines.push(attrs[i]); }

        // SKU：买家侧给规格与价格，卖家侧补外部编码与库存。
        var pub = qnPublicSkus(d);
        var sellerById = {};
        for (var s = 0; s < bag.sellerSkus.length; s++) { var ss = bag.sellerSkus[s] || {}; sellerById[String(ss.skuId || ss.sku_id || '')] = ss; }
        var skuRows = [];
        if (pub.length) {
          for (var p = 0; p < pub.length; p++) {
            var row = pub[p], seller = sellerById[row.skuId] || {};
            var cell = row.spec || (seller.description || '默认规格');
            var price = row.price !== '' ? row.price : (seller.price !== undefined && seller.price !== null ? (Number(seller.price) > 0 && String(seller.price).indexOf('.') < 0 ? (Number(seller.price) / 100).toFixed(2) : String(seller.price)) : '');
            if (price !== '') { cell += '　价格 ' + price; }
            var stock = seller.quantity !== undefined ? seller.quantity : row.stock;
            if (stock !== undefined && stock !== null && stock !== '') { cell += '　库存 ' + stock; }
            if (seller.outerId) { cell += '　编码 ' + seller.outerId; }
            skuRows.push(cell);
          }
        } else {
          for (var q = 0; q < bag.sellerSkus.length; q++) {
            var sk = bag.sellerSkus[q] || {};
            var c2 = String(sk.description || '默认规格');
            if (sk.price !== undefined && sk.price !== null && sk.price !== '') { c2 += '　价格 ' + (String(sk.price).indexOf('.') < 0 && Number(sk.price) > 0 ? (Number(sk.price) / 100).toFixed(2) : sk.price); }
            if (sk.quantity !== undefined && sk.quantity !== null && sk.quantity !== '') { c2 += '　库存 ' + sk.quantity; }
            if (sk.outerId) { c2 += '　编码 ' + sk.outerId; }
            skuRows.push(c2);
          }
        }
        // 一条规格都没有 = 单规格商品，价格库存在 `sku2info["0"]` 里。
        if (skuRows.length === 0) { var solo = qnSingleSku(d); if (solo !== '') { skuRows.push(solo); } }
        if (skuRows.length) { lines.push('规格与价格：'); for (var z = 0; z < skuRows.length; z++) { lines.push('  ' + skuRows[z]); } }

        // 尺码表。服装类目才有，别的类目恒为 0 —— **这不是异常**。
        var size = qnSizeLines(d);
        if (size.lines.length) { lines.push('尺码表：'); for (var sz = 0; sz < size.lines.length; sz++) { lines.push(size.lines[sz]); } }

        // 图：pcdetail 的轮播图 + SKU 图。
        var imgs = [], imgSeen = {};
        function pushImg(u) { if (!u) { return; } var full = qnAbs(typeof u === 'object' ? (u.url || u.image || u.src) : u); if (full && !imgSeen[full]) { imgSeen[full] = 1; imgs.push(full); } }
        var il = jdIsArray(item.images) ? item.images : (jdIsArray(item.imageList) ? item.imageList : []);
        for (var m = 0; m < il.length; m++) { pushImg(il[m]); }
        var sp = (d.skuBase && jdIsArray(d.skuBase.props)) ? d.skuBase.props : [];
        for (var sp1 = 0; sp1 < sp.length; sp1++) { var vs = jdIsArray(sp[sp1].values) ? sp[sp1].values : []; for (var sp2 = 0; sp2 < vs.length; sp2++) { pushImg(vs[sp2] && (vs[sp2].image || vs[sp2].imageUrl)); } }

        // 详情图排在轮播图后面（顺序就是商家排的顺序）。
        var dimgs = jdIsArray(bag.descImgs) ? bag.descImgs : [];
        for (var di = 0; di < dimgs.length; di++) { pushImg(dimgs[di]); }

        // 描述正文。按顺序拼、总长封顶 —— 这一段会进 AI 的提示词，按字收费。
        var descText = '';
        var tx = jdIsArray(bag.texts) ? bag.texts : [];
        for (var t = 0; t < tx.length; t++) {
          var one = String(tx[t] || '').trim();
          if (one === '') { continue; }
          if (descText.length + one.length > 1200) { break; }
          descText += (descText === '' ? '' : '\n') + one;
        }

        return {
          ok: true,
          attrsText: lines.join('\n'),
          desc: descText,
          images: imgs,
          title: typeof item.title === 'string' ? item.title : '',
          attrCount: attrs.length,
          propCount: attrs.length,
          sizeRows: size.rows,
          skuCount: skuRows.length,
          unresolved: [],
          skuErr: bag.skuErr || '',
          detailErr: detailErr,
          sizeErr: bag.descErr || '',
          // 属性为 0 时把顶层键带回去 —— 排查「这个类目的属性藏在哪」的唯一线索。
          detailKeys: attrs.length === 0 && detail ? Object.keys(d).slice(0, 30) : [],
          clientPath: 'lib.mtop'
        };
      })
      .then(null, function (e) { return { ok: false, reason: qnErr(e), clientPath: 'lib.mtop' }; });
  };

  // ---- 拼多多：接口通道 -----------------------------------------------------
  //
  // 与京麦/抖店同一个形状。请求层是商家后台微前端壳自己的 `window.__mms.network`
  // （`= __mms.fetch`，有 get/post/put/del）—— 它的源码里自己算 `Anti-Content`、
  // 自己带 `VerifyAuthToken`。**老工程去抓包复用的那个头，页面这个模块本来就会算**：
  // 老工程 `pdd_shop.js` 是 B 类（复用抓来的 anti-content，注释里自己承认会在分页
  // 中途失效、静默截断为 80/90 条），这里是 A 类。
  //
  // 2026-09-13 真机（一件商品，男装 > 休闲裤）验到的事实：
  //
  // - 清单 `POST /vodka/v2/mms/query/display/mall/goodsList`，**body 必须照页面自己发的**：
  //   `{pre_sale_type:4, page, out_goods_sn_gray_flag:true, shipment_time_type:3, is_onsale:1, sold_out:0, size}`。
  //   老工程那套 defaults（一堆 -1 和空数组）回 `total: 0` —— 它自己注释里说的
  //   「缺失字段和传空数组在拼多多后台的含义不同」，这次真机撞上了。
  //   响应 `{total, goods_list[]}`；行里 `id / goods_name / hd_thumb_url / is_onsale /
  //   sku_group_price:[min,max] / cat_name_1..4`。
  // - 对账 `POST /vodka/v2/mms/query/display/mall_goods/count {excluded_goods_type_list:[112]}`
  //   → `on_sale_num`。
  // - **价格单位是分**（5900 ↔ ¥59），和抖店一样。
  // - 详情三个接口：`/glide/v2/mms/query/commit/on_shop/detail {goods_id}`（类目路径 `cats`、
  //   轮播图 `carousel_gallery`、详情图 `detail_gallery`、**尺码图 `size_gallery`**、描述 `goods_desc`），
  //   `/vodka/v2/mms/query/sku/info {goodsId}`（`spec[].{spec_key, spec_value}`、`group_price`、`quantity`），
  //   `/draco-ms/mms/query-goods-property {goods_id}`（`goods_properties[].{name, values[].value}` ——
  //   **直接是这件商品的取值**，14 条全中，没有候选表那回事）。
  //
  // # 老工程那份不能照抄的两处
  //
  // 它 `Promise.all` 并发打三个详情接口 —— 这里串行。它对 total 的处理值得留下：
  // 「即便累计数已达到接口 total，只要本页仍满，仍请求下一页验证」——
  // 有店铺把 400 件报成 80 件。所以这里**只按「本页不满」和「没有新商品」停**，
  // 不按 total 停。

  var PDD_ITEM_URL = 'https://mobile.yangkeduo.com/goods.html?goods_id='; // gate-allow: 拼多多买家侧商品页固定前缀（老工程同一常量），只当 Referer 和商品链接用，不发请求

  function pddNet() {
    var m = window.__mms;
    var n = m && (m.network || m.fetch);
    return (n && typeof n.post === 'function') ? n : null;
  }

  function pddErr(e) {
    if (!e) { return '未知错误'; }
    if (e.message) { return String(e.message); }
    if (e.error_msg || e.errorMessage || e.errorMsg) { return String(e.error_msg || e.errorMessage || e.errorMsg); }
    try { return JSON.stringify(e).slice(0, 200); } catch (_) { return String(e); }
  }

  // 分 → 元。整数不带小数（「59」），有零头才带（「59.9」）。
  function pddYuan(cents) {
    var n = Number(cents);
    if (!isFinite(n)) { return ''; }
    var y = n / 100;
    return (Math.round(y * 100) === Math.round(y) * 100) ? String(Math.round(y)) : String(Math.round(y * 100) / 100);
  }

  // `[min, max]`（分）→「59」或「59 ~ 99」。
  function pddRange(v) {
    if (jdIsArray(v) && v.length) {
      var lo = v[0], hi = v[v.length - 1];
      if (lo === undefined || lo === null) { return ''; }
      return (hi === undefined || hi === null || String(lo) === String(hi)) ? pddYuan(lo) : (pddYuan(lo) + ' ~ ' + pddYuan(hi));
    }
    if (v !== undefined && v !== null && v !== '') { return pddYuan(v); }
    return '';
  }

  function pddListPrice(row) {
    var p = pddRange(row.sku_group_price);
    if (p === '') { p = pddRange(row.sku_price); }
    if (p === '') { p = pddRange(row.market_price); }
    return p;
  }

  function pddImg(u) {
    if (!u) { return ''; }
    if (typeof u === 'object') { u = u.url || u.imageUrl || u.thumbUrl || u.src || ''; }
    u = String(u);
    return u.indexOf('//') === 0 ? 'https:' + u : u;
  }

  ops.pddApiList = function (args) {
    var a = args || {};
    var pageSize = Number(a.pageSize) > 0 ? Number(a.pageSize) : 20;
    var maxPages = Number(a.maxPages) > 0 ? Math.min(Number(a.maxPages), 100) : 100;
    var pageDelay = Number(a.pageDelay) >= 0 ? Number(a.pageDelay) : 500;
    var net = pddNet();
    if (!net) { return Promise.resolve({ ok: false, reason: '页面里没有 __mms.network（商家后台壳的请求层）—— 页面可能还没加载完，或已改版', items: [] }); }
    var items = [], seen = {}, pages = 0, declared = 0, statusCounts = {};

    function body(n) {
      // **照页面自己发的原样**，见上面模块注释。
      return { pre_sale_type: 4, page: n, out_goods_sn_gray_flag: true, shipment_time_type: 3, is_onsale: 1, sold_out: 0, size: pageSize };
    }
    function step(n) {
      if (n > maxPages) { return Promise.resolve(); }
      return net.post('/vodka/v2/mms/query/display/mall/goodsList', body(n)).then(function (r) {
        pages += 1;
        if (n === 1 && declared === 0) { declared = Number(r && r.total) || 0; }
        var rows = (r && jdIsArray(r.goods_list)) ? r.goods_list : [];
        var fresh = 0;
        for (var i = 0; i < rows.length; i++) {
          var g = rows[i] || {};
          var id = String(g.id || g.goods_id || '');
          var title = String(g.goods_name || '').trim();
          if (title === '') { continue; }
          var key = id !== '' ? id : title;
          if (Object.prototype.hasOwnProperty.call(seen, key)) { continue; }
          seen[key] = 1; fresh += 1;
          var sk = (g.is_onsale === undefined || g.is_onsale === null) ? 'null' : String(g.is_onsale);
          statusCounts[sk] = (statusCounts[sk] || 0) + 1;
          var thumb = pddImg(g.hd_thumb_url || g.thumb_url || g.image_url);
          items.push({
            title: title,
            itemId: id,
            price: pddListPrice(g),
            thumb: thumb,
            alias: '',
            images: thumb ? [thumb] : [],
            itemHref: id ? (PDD_ITEM_URL + id) : '',
            itemStatus: g.is_onsale === true ? 1 : (g.is_onsale === false ? 0 : null)
          });
        }
        // 只按「本页不满」和「没有新商品」停，不按 total 停 —— 老工程见过 400 件报成 80 件。
        if (fresh === 0) { return; }
        if (rows.length < pageSize) { return; }
        return jdSleep(pageDelay).then(function () { return step(n + 1); });
      });
    }

    // 先问在售件数当对账真相；失败不影响清单。
    return net.post('/vodka/v2/mms/query/display/mall_goods/count', { excluded_goods_type_list: [112] })
      .then(function (c) { var n = Number(c && c.on_sale_num); if (isFinite(n) && n > 0) { declared = n; } }, function () {})
      .then(function () { return jdSleep(Math.min(pageDelay, 400)); })
      .then(function () { return step(1); })
      .then(function () {
        return { ok: true, items: items, pages: pages, declared: declared, statusCounts: statusCounts, clientPath: '__mms.network' };
      }, function (e) {
        return { ok: false, reason: pddErr(e), clientPath: '__mms.network', items: [] };
      });
  };

  ops.pddApiDetail = function (args) {
    var a = args || {};
    var id = String(a.productId || a.goodsId || '').trim();
    if (id === '') { return Promise.resolve({ ok: false, reason: '没有给出商品 id' }); }
    var itemDelay = Number(a.itemDelay) >= 0 ? Number(a.itemDelay) : 250;
    var net = pddNet();
    if (!net) { return Promise.resolve({ ok: false, reason: '页面里没有 __mms.network' }); }

    var detail = null, detailErr = '', skus = [], skuErr = '', props = [], propsErr = '';
    return net.post('/glide/v2/mms/query/commit/on_shop/detail', { goods_id: id })
      .then(function (r) { detail = (r && typeof r === 'object') ? r : null; }, function (e) { detailErr = pddErr(e); })
      .then(function () { return jdSleep(itemDelay); })
      .then(function () {
        return net.post('/vodka/v2/mms/query/sku/info', { goodsId: id })
          .then(function (r) { skus = jdIsArray(r) ? r : (r && jdIsArray(r.sku_list) ? r.sku_list : []); }, function (e) { skuErr = pddErr(e); });
      })
      .then(function () { return jdSleep(itemDelay); })
      .then(function () {
        return net.post('/draco-ms/mms/query-goods-property', { goods_id: id })
          .then(function (r) { props = (r && jdIsArray(r.goods_properties)) ? r.goods_properties : []; }, function (e) { propsErr = pddErr(e); });
      })
      .then(function () {
        var d = detail || {};
        var lines = [];
        // 类目路径：detail.cats 是 ["男装","休闲裤","休闲裤",null]，空的和连续重复的去掉。
        var cats = jdIsArray(d.cats) ? d.cats : [];
        var path = [];
        for (var c = 0; c < cats.length; c++) {
          var nm = cats[c];
          if (typeof nm === 'string' && nm.trim() !== '' && path[path.length - 1] !== nm.trim()) { path.push(nm.trim()); }
        }
        if (path.length) { lines.push('商品类目: ' + path.join(' > ')); }
        // 属性：取值直接在 values 里，单位拼上。
        var attrCount = 0;
        for (var p = 0; p < props.length; p++) {
          var pr = props[p] || {};
          var vals = jdIsArray(pr.values) ? pr.values : [];
          var names = [];
          for (var v = 0; v < vals.length; v++) {
            var one = vals[v] || {};
            var val = (one.value !== undefined && one.value !== null) ? String(one.value) : '';
            if (val === '') { continue; }
            // 取值本身已经带了单位（「50%（含）-70%（不含）」）就别再拼一次 —— 真机上拼出来是「…%」。
            var unit = one.unit ? String(one.unit) : '';
            names.push(unit && val.indexOf(unit) < 0 ? (val + unit) : val);
          }
          if (pr.name && names.length) { lines.push(String(pr.name) + ': ' + names.join('、')); attrCount++; }
        }
        // SKU：规格 = 各维度「维度名 取值」；价格团购价（分→元）；库存；编码。
        var skuRows = 0;
        if (skus.length) {
          lines.push('规格与价格：');
          for (var s = 0; s < skus.length; s++) {
            var sk = skus[s] || {};
            var specs = jdIsArray(sk.spec) ? sk.spec : [];
            var parts = [];
            for (var q = 0; q < specs.length; q++) {
              var sp = specs[q] || {};
              var sv = sp.spec_value || sp.spec_name || '';
              if (sv) { parts.push((sp.spec_key || sp.parent_name ? String(sp.spec_key || sp.parent_name) + ' ' : '') + String(sv)); }
            }
            var cell = parts.length ? parts.join('　') : '默认规格';
            var price = pddRange(sk.group_price !== undefined && sk.group_price !== null ? sk.group_price : sk.multi_price);
            if (price !== '') { cell += '　价格 ' + price; }
            if (sk.quantity !== undefined && sk.quantity !== null && sk.quantity !== '') { cell += '　库存 ' + sk.quantity; }
            if (sk.out_sku_sn) { cell += '　编码 ' + sk.out_sku_sn; }
            if (sk.is_onsale === false || sk.is_onsale === 0) { cell += '　（已下架）'; }
            lines.push('  ' + cell); skuRows++;
          }
        }
        // 图：轮播 + 详情图 + 尺码图 + SKU 图。
        var imgs = [], imgSeen = {};
        function pushImg(u) { var full = pddImg(u); if (full && !Object.prototype.hasOwnProperty.call(imgSeen, full)) { imgSeen[full] = 1; imgs.push(full); } }
        var sizeImgs = 0;
        var groups = ['carousel_gallery', 'detail_gallery', 'size_gallery'];
        for (var gi = 0; gi < groups.length; gi++) {
          var arr = jdIsArray(d[groups[gi]]) ? d[groups[gi]] : [];
          for (var ai = 0; ai < arr.length; ai++) { pushImg(arr[ai]); if (groups[gi] === 'size_gallery') { sizeImgs++; } }
        }
        for (var si = 0; si < skus.length; si++) { pushImg(skus[si] && skus[si].thumb_url); }
        var desc = typeof d.goods_desc === 'string' ? d.goods_desc.trim() : '';

        return {
          ok: true,
          attrsText: lines.join('\n'),
          desc: desc,
          images: imgs,
          title: typeof d.goods_name === 'string' ? d.goods_name : '',
          attrCount: attrCount,
          propCount: props.length,
          sizeRows: 0,
          sizeImages: sizeImgs,
          skuCount: skuRows,
          unresolved: [],
          skuErr: skuErr,
          detailErr: detailErr || propsErr,
          clientPath: '__mms.network'
        };
      })
      .then(null, function (e) { return { ok: false, reason: pddErr(e), clientPath: '__mms.network' }; });
  };

  // ---- 快手小店：接口通道 -----------------------------------------------------
  //
  // 与京麦/抖店/拼多多同一个形状。**这家用页面自己的 `fetch` 就够了**：2026-09-13
  // 真机，清单 `queryList` 和详情 `nexus/render` 用裸 `fetch(credentials:'include')`
  // 直接通，服务端只看 cookie（`merchantSessionKey` 等），没有要我们算的签名。
  // 老工程 `kuaishou_shop.js` 是 B 类（复用抓来的 `anti-content` 一组头）—— 这次
  // 真机上那组头一个都没带，照样成。
  //
  // 页面上 `window['@es/request/pc']` 那个 axios 实例是个没配适配器的空壳
  // （`post` 会报 `r is not a function`），商品微应用（single-spa）自己的实例
  // 不在 window 上 —— 找了三轮才确认不用找它。
  //
  // # 真机形状（一件商品，男装 > 裤子 > 休闲裤，7 个 SKU）
  //
  // - 清单 `POST /rest/pc/product/manage/kcf/item/manager/queryList`，**分页是嵌套的**：
  //   `{managerTab:'ON_SALE', pagination:{curPage, pageSize}, queryForm:{soldQuantityPeriodQuery:'',
  //   itemProfileQuery:'normal'}, tableSort:{volumeFilter:''}}` —— 平铺的 pageNum/pageSize
  //   一律回「单页最多支持展示50条数据」（服务端根本没读到分页字段）。
  //   响应 `data.{curPage, pageSize, total, dataSource[]}`；行里 `itemId`、`status.{statusKey,
  //   statusText}`、`itemDesc.{mainImage[], title.text, goodsDetailUrlForC}`、
  //   `managerPrice.price:['59','59']`（**元**，字符串区间）、`managerItemStock.quantity`。
  // - 对账 `POST …/kcf/item/manager/render {}` → `data.managerTab.tabData[]` 里
  //   `{key:'ON_SALE', count}`。
  // - 详情 `POST /rest/pc/product/manage/item/publish/nexus/render
  //   {model:'edit', itemId, step:'1', __CUSTOM__:'true'}`，一次约 150KB，全在里面：
  //   标题 `data.itemTitle.fields.value.inputValue`；主图 `data.mainImage.fields.value[]`；
  //   类目 `global.categoryNamePath[]`；属性 —— **定义在 `data.goodsAttrs.fields.itemProps.propList[]`
  //   （propId → propName，整个类目的），取值在 `data.goodsAttrs.fields.value[]`
  //   （propValue 是 JSON 字符串）**，京麦那节讲过为什么要分开；SKU
  //   `data.skuTable.fields.value[].value.{price, stock, skuId, skuNo, image, relationSpecificationList[]}`；
  //   尺码表 `data.sizeChart.fields.value.sizeChartContent`（JSON 字符串，
  //   `{meta:{headerName, params[]}, data:[{尺码:[…], 体重:[低,高], 身高:[低,高]}]}`）；
  //   详情图 `data.decorate.fields.value.decorateImages[].url`。

  function ksPost(path, body) {
    return fetch(path, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
      .then(function (res) {
        return res.text().then(function (text) {
          var json;
          try { json = JSON.parse(text); } catch (_) { throw new Error(path + ' 返回的不是 JSON（HTTP ' + res.status + '）：' + text.slice(0, 120)); }
          if (!res.ok) { throw new Error(path + ' HTTP ' + res.status); }
          if (json && json.result !== undefined && Number(json.result) !== 1) {
            throw new Error(path + ' ' + json.result + '：' + (json.error_msg || json.message || '接口没成'));
          }
          return json;
        });
      });
  }

  function ksErr(e) { return (e && e.message) ? String(e.message) : String(e); }

  // `['59','59']` → 「59」；`['59','99']` → 「59 ~ 99」。快手给的已经是元。
  function ksRange(v) {
    if (jdIsArray(v) && v.length) {
      var lo = String(v[0] || '').trim(), hi = String(v[v.length - 1] || '').trim();
      if (lo === '') { return ''; }
      return (hi === '' || lo === hi) ? lo : (lo + ' ~ ' + hi);
    }
    return (v === undefined || v === null) ? '' : String(v).trim();
  }

  function ksAbs(u) {
    if (!u) { return ''; }
    if (typeof u === 'object') { u = u.url || u.imageUrl || u.src || ''; }
    u = String(u);
    return u.indexOf('//') === 0 ? 'https:' + u : u;
  }

  // 表单组件的值：`x.fields.value`。
  function ksVal(form, key) {
    var c = form && form[key];
    return (c && c.fields && Object.prototype.hasOwnProperty.call(c.fields, 'value')) ? c.fields.value : undefined;
  }

  ops.ksApiList = function (args) {
    var a = args || {};
    var pageSize = Number(a.pageSize) > 0 ? Math.min(Number(a.pageSize), 50) : 20;
    var maxPages = Number(a.maxPages) > 0 ? Math.min(Number(a.maxPages), 100) : 100;
    var pageDelay = Number(a.pageDelay) >= 0 ? Number(a.pageDelay) : 500;
    var tab = String(a.tab || 'ON_SALE');
    var items = [], seen = {}, pages = 0, declared = 0, statusCounts = {};

    function body(n) {
      return { managerTab: tab, pagination: { curPage: n, pageSize: pageSize }, queryForm: { soldQuantityPeriodQuery: '', itemProfileQuery: 'normal' }, tableSort: { volumeFilter: '' } };
    }
    function step(n) {
      if (n > maxPages) { return Promise.resolve(); }
      return ksPost('/rest/pc/product/manage/kcf/item/manager/queryList', body(n)).then(function (r) {
        pages += 1;
        var d = (r && r.data) || {};
        if (n === 1 && declared === 0) { declared = Number(d.total) || 0; }
        var rows = jdIsArray(d.dataSource) ? d.dataSource : [];
        var fresh = 0;
        for (var i = 0; i < rows.length; i++) {
          var g = rows[i] || {};
          var desc = g.itemDesc || {};
          var title = String((desc.title && (desc.title.text || desc.title)) || '').trim();
          var id = String(g.itemId || '').trim();
          if (title === '') { continue; }
          var key = id !== '' ? id : title;
          if (Object.prototype.hasOwnProperty.call(seen, key)) { continue; }
          seen[key] = 1; fresh += 1;
          var st = g.status || {};
          var sk = (st.statusText !== undefined && st.statusText !== null) ? String(st.statusText) : 'null';
          statusCounts[sk] = (statusCounts[sk] || 0) + 1;
          var mains = jdIsArray(desc.mainImage) ? desc.mainImage : [];
          var imgs = [];
          for (var m = 0; m < mains.length; m++) { var u = ksAbs(mains[m]); if (u) { imgs.push(u); } }
          items.push({
            title: title,
            itemId: id,
            price: ksRange(g.managerPrice && g.managerPrice.price),
            thumb: imgs[0] || '',
            alias: '',
            images: imgs,
            itemHref: String(desc.goodsDetailUrlForC || ''),
            itemStatus: (typeof st.statusKey === 'number') ? st.statusKey : null
          });
        }
        if (fresh === 0) { return; }
        if (rows.length < pageSize) { return; }
        return jdSleep(pageDelay).then(function () { return step(n + 1); });
      });
    }

    // 先问页签件数当对账真相；失败不影响清单。
    return ksPost('/rest/pc/product/manage/kcf/item/manager/render', {})
      .then(function (r) {
        var tabs = (r && r.data && r.data.managerTab && jdIsArray(r.data.managerTab.tabData)) ? r.data.managerTab.tabData : [];
        for (var i = 0; i < tabs.length; i++) { if (tabs[i] && tabs[i].key === tab && Number(tabs[i].count) > 0) { declared = Number(tabs[i].count); } }
      }, function () {})
      .then(function () { return jdSleep(Math.min(pageDelay, 400)); })
      .then(function () { return step(1); })
      .then(function () {
        return { ok: true, items: items, pages: pages, declared: declared, statusCounts: statusCounts, clientPath: 'fetch' };
      }, function (e) {
        return { ok: false, reason: ksErr(e), clientPath: 'fetch', items: [] };
      });
  };

  // `propValue` 是 JSON 字符串：`{"propValueId":…,"propValue":"如妮缘"}` 或
  // `[{"propValueId":…,"propValue":"秋季"}]`，也可能是裸文本。
  function ksPropNames(raw) {
    var v = raw;
    if (typeof v === 'string') {
      var t = v.trim();
      if (t.charAt(0) === '{' || t.charAt(0) === '[') { try { v = JSON.parse(t); } catch (_) { v = t; } }
    }
    var out = [];
    var one = function (x) {
      if (x === undefined || x === null) { return; }
      if (typeof x === 'object') {
        var nm = x.propValue !== undefined ? x.propValue : (x.propValueName !== undefined ? x.propValueName : (x.propValueInputText !== undefined ? x.propValueInputText : x.value));
        if (nm !== undefined && nm !== null && String(nm).trim() !== '') { out.push(String(nm).trim() + (x.unitPropValueName ? ' ' + x.unitPropValueName : '')); }
        return;
      }
      if (String(x).trim() !== '') { out.push(String(x).trim()); }
    };
    if (jdIsArray(v)) { for (var i = 0; i < v.length; i++) { one(v[i]); } } else { one(v); }
    return out;
  }

  // 尺码表：`{meta:{headerName:'尺码', params:['体重','身高']}, data:[{尺码:['160/74A'], 体重:['80','100'], 身高:['160','165']}]}`
  // → 「  尺码 160/74A　体重 80-100　身高 160-165」
  function ksSizeLines(content) {
    var lines = [];
    var c = content;
    if (typeof c === 'string') { try { c = JSON.parse(c); } catch (_) { return lines; } }
    if (!c || typeof c !== 'object') { return lines; }
    var meta = c.meta || {};
    var head = String(meta.headerName || '尺码');
    var params = jdIsArray(meta.params) ? meta.params : [];
    var rows = jdIsArray(c.data) ? c.data : [];
    var cell = function (v) { if (jdIsArray(v)) { var xs = []; for (var i = 0; i < v.length; i++) { if (v[i] !== undefined && v[i] !== null && String(v[i]) !== '') { xs.push(String(v[i])); } } return xs.length === 2 && xs[0] !== xs[1] ? (xs[0] + '-' + xs[1]) : xs.join('/'); } return (v === undefined || v === null) ? '' : String(v); };
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r] || {};
      var parts = [];
      var hv = cell(row[head]);
      if (hv !== '') { parts.push(head + ' ' + hv); }
      var order = params.length ? params : Object.keys(row).filter(function (k) { return k !== head; });
      for (var p = 0; p < order.length; p++) { var pv = cell(row[order[p]]); if (pv !== '') { parts.push(order[p] + ' ' + pv); } }
      if (parts.length) { lines.push('  ' + parts.join('　')); }
    }
    return lines;
  }

  ops.ksApiDetail = function (args) {
    var a = args || {};
    var id = String(a.productId || a.itemId || '').trim();
    if (id === '') { return Promise.resolve({ ok: false, reason: '没有给出商品 id' }); }
    return ksPost('/rest/pc/product/manage/item/publish/nexus/render', { model: 'edit', itemId: id, step: '1', __CUSTOM__: 'true' })
      .then(function (r) {
        var root = (r && r.data) || {};
        var form = root.data || {};
        var glob = root.global || {};
        var lines = [];
        var titleV = ksVal(form, 'itemTitle');
        var title = (titleV && typeof titleV === 'object') ? String(titleV.inputValue || '') : String(titleV || '');
        var path = jdIsArray(glob.categoryNamePath) ? glob.categoryNamePath.filter(function (x) { return typeof x === 'string' && x.trim() !== ''; }) : [];
        if (path.length) { lines.push('商品类目: ' + path.join(' > ')); }

        // 属性：名字只从 propList 取，取值只从 value 取。
        var ga = (form.goodsAttrs && form.goodsAttrs.fields) || {};
        var defs = (ga.itemProps && jdIsArray(ga.itemProps.propList)) ? ga.itemProps.propList : [];
        var nameOf = {};
        for (var d = 0; d < defs.length; d++) { var df = defs[d] || {}; if (df.propId !== undefined && df.propId !== null && df.propName) { nameOf[String(df.propId)] = String(df.propName); } }
        var vals = jdIsArray(ga.value) ? ga.value : [];
        var attrCount = 0, unresolved = [];
        for (var v = 0; v < vals.length; v++) {
          var it = vals[v] || {};
          var nm = nameOf[String(it.propId)];
          var names = ksPropNames(it.propValue);
          if (!nm) { unresolved.push('名字?' + it.propId); nm = '属性' + it.propId; }
          if (names.length) { lines.push(nm + ': ' + names.join('、')); attrCount++; }
        }

        // SKU
        var skuRows = jdIsArray(ksVal(form, 'skuTable')) ? ksVal(form, 'skuTable') : [];
        var skuCount = 0, imgs = [], imgSeen = {};
        function pushImg(u) { var full = ksAbs(u); if (full && !Object.prototype.hasOwnProperty.call(imgSeen, full)) { imgSeen[full] = 1; imgs.push(full); } }
        var mains = ksVal(form, 'mainImage');
        if (jdIsArray(mains)) { for (var m = 0; m < mains.length; m++) { pushImg(mains[m]); } }
        if (skuRows.length) {
          lines.push('规格与价格：');
          for (var s = 0; s < skuRows.length; s++) {
            var sk = (skuRows[s] && skuRows[s].value) || skuRows[s] || {};
            var specs = jdIsArray(sk.relationSpecificationList) ? sk.relationSpecificationList : [];
            var parts = [];
            for (var q = 0; q < specs.length; q++) { var sp = specs[q] || {}; var sv = sp.propValueName || sp.propValueInputText || ''; if (sv) { parts.push((sp.propName ? String(sp.propName) + ' ' : '') + String(sv)); } }
            var cell = parts.length ? parts.join('　') : '默认规格';
            if (sk.price !== undefined && sk.price !== null && String(sk.price) !== '') { cell += '　价格 ' + sk.price; }
            var stock = sk.stock !== undefined ? sk.stock : sk.currentStock;
            if (stock !== undefined && stock !== null && String(stock) !== '') { cell += '　库存 ' + stock; }
            if (sk.skuNo) { cell += '　编码 ' + sk.skuNo; }
            lines.push('  ' + cell); skuCount++;
            pushImg(sk.image);
          }
        }

        // 尺码表
        var sc = ksVal(form, 'sizeChart');
        var sizeLines = ksSizeLines(sc && typeof sc === 'object' ? sc.sizeChartContent : sc);
        if (sizeLines.length) { lines.push('尺码表：'); for (var z = 0; z < sizeLines.length; z++) { lines.push(sizeLines[z]); } }

        // 详情图
        var deco = ksVal(form, 'decorate');
        var decoImgs = (deco && jdIsArray(deco.decorateImages)) ? deco.decorateImages : [];
        for (var di = 0; di < decoImgs.length; di++) { pushImg(decoImgs[di] && decoImgs[di].url); }

        var sell = ksVal(form, 'sellingPoint');
        var desc = typeof sell === 'string' ? sell.trim() : '';

        return {
          ok: true,
          attrsText: lines.join('\n'),
          desc: desc,
          images: imgs,
          title: title,
          attrCount: attrCount,
          propCount: vals.length,
          sizeRows: sizeLines.length,
          skuCount: skuCount,
          unresolved: unresolved.slice(0, 20),
          skuErr: '',
          detailErr: '',
          clientPath: 'fetch'
        };
      })
      .then(null, function (e) { return { ok: false, reason: ksErr(e), clientPath: 'fetch' }; });
  };

  // ---- 小红书（千帆 ark）：接口通道 -------------------------------------------
  //
  // # 老工程是 C 类，我们找到了 A 类
  //
  // 老工程 `xiaohongshu_shop.js` 自己拼 `x-s`（`window.mnsv2` + 一张改过的
  // base64 字母表 + `localStorage['ark-access-token']`），所以它的
  // `publish_render` 能通。2026-09-13 真机把签名这一层摸清了：
  //
  // - ark 是 qiankun 微前端。商品那块是子应用 `itemark`，它的 webpack 运行时挂
  //   在沙箱窗口 `window.proxy.webpackChunkitemark` 上，**不在真 window**。
  // - 子应用有自己的 Launcher http 客户端（`interceptors` 里有 `spam` /
  //   `dispatch` 队列）。它的 dispatch 拦截器用 `mnsv2` 算长签名
  //   （`X-s: XYS_…`）并补 `X-S-Common`。**用它发，服务端就认。**
  // - 主应用 `webpackChunkark_app_root` 那个客户端只会算短签名（不带
  //   `X-S-Common`），发 `publish_render` 回 300014「设备异常，请尝试关闭/卸载
  //   风险插件」—— 那不是被风控，是走错了客户端。
  // - 裸 `fetch` 一个签名头都没有：`search_item_v2` 不查所以能过，
  //   `publish_render` 查所以 406。
  //
  // 所以：**先找子应用的客户端，找不到再退到裸 fetch**。前者两个接口都能走；
  // 后者只有清单能走，详情退回「清单按 id 精确取一件」那条（少 SKU 明细和描述）。
  //
  // # 详情 = publish_render
  //
  // 和老工程一样 POST `{data: JSON.stringify({publishType:2, sourceType:1,
  // itemId})}`，`transform:false` 拿原样（返回是一段 JSON **字符串**）。取值只从
  // `product.productDetail.item`（`properties[].propertyValueList[].value`、
  // `categoryPath[].categoryName`、`images` / `longImages` / `imageDescriptions`、
  // `description`）和 `productDetail.skuList[]`（`skuVariantInfos[]`、
  // `basePriceInfo.price` 分、`baseStockInfos[].stock`）。
  // `category.categoryPropertyInfo.{saleProperties,descProperties}` 是**整个类目
  // 的候选**，一条都不取（候选 vs 取值那个坑）。
  //
  // # 两个真机事实
  //
  // - **价格是分**：`basePriceInfo.price:5000` ↔ 页面 ¥50。
  // - `card_type`：2 = 售卖中（和 `/list/shelf` 那页一致），3 = 含下架。
  //   清单默认 2；按 id 精确取那条兜底先 3 再 2。

  var XHS_LIST_API = '/api/edith/product/search_item_v2';
  var XHS_RENDER_API = '/api/edith/product/publish_render';
  var XHS_DETAIL_OPTION = {
    with_product_quality_score: true, with_hot_item_award_text_info: true,
    with_ai_publish_note_permission: true, with_inventory_risk_info: true,
    with_item_lock_info: true
  };

  // 子应用的 http 客户端长这样：有 `interceptors.spam`、有 `post`。
  function xhsIsClient(v) {
    try {
      return !!(v && (typeof v === 'object' || typeof v === 'function') && v.interceptors && typeof v.interceptors === 'object' && ('spam' in v.interceptors) && typeof v.post === 'function');
    } catch (_) { return false; }
  }
  // webpack5 的老招：往 chunk 数组 push 一个假 chunk，拿 `__webpack_require__`。
  function xhsChunkRequire(chunk) {
    var req = null;
    try {
      if (!chunk || typeof chunk.push !== 'function') { return null; }
      chunk.push([['__sh_xhs_' + Math.random().toString(36).slice(2)], {}, function (r) { req = r; }]);
    } catch (_) { return null; }
    return (req && req.m) ? req : null;
  }
  // 在一个运行时里找客户端。**先走精确路**：找源码里调
  // `.post("/api/edith/product/publish_render")` 的那个模块，顺着它 `x.LV.post`
  // 的 `x=r(14623)` 找到客户端所在模块，只求值那一个模块。精确路失手才全扫
  // 导出（全扫会把没加载过的模块也跑一遍，能不做就不做）。
  function xhsClientIn(req, where) {
    var ids = Object.keys(req.m);
    var i, exp;
    for (i = 0; i < ids.length; i++) {
      var src = String(req.m[ids[i]]);
      if (src.indexOf('"' + XHS_RENDER_API + '"') < 0) { continue; }
      var call = src.match(/([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\.post\("\/api\/edith\/product\/publish_render"/);
      if (!call) { continue; }
      var dep = src.match(new RegExp('[,;(\\s]' + call[1].replace(/\$/g, '\\$') + '\\s*=\\s*[A-Za-z_$][\\w$]*\\((\\d+)\\)'));
      if (!dep) { continue; }
      try { exp = req(dep[1]); } catch (_) { continue; }
      if (exp && xhsIsClient(exp[call[2]])) { return { client: exp[call[2]], path: where + '#' + dep[1] + '.' + call[2] }; }
    }
    for (i = 0; i < ids.length; i++) {
      try { exp = req(ids[i]); } catch (_) { continue; }
      if (!exp || (typeof exp !== 'object' && typeof exp !== 'function')) { continue; }
      var eks;
      try { eks = Object.keys(exp); } catch (_) { continue; }
      for (var e = 0; e < eks.length; e++) {
        var cand;
        try { cand = exp[eks[e]]; } catch (_) { continue; }
        if (xhsIsClient(cand)) { return { client: cand, path: where + '#' + ids[i] + '.' + eks[e] + '(scan)' }; }
      }
    }
    return null;
  }
  var xhsClientCache = null;
  function xhsFindClient() {
    if (xhsClientCache) { return xhsClientCache; }
    var roots = [];
    try { if (window.proxy && typeof window.proxy === 'object') { roots.push({ where: 'proxy', obj: window.proxy }); } } catch (_) {}
    roots.push({ where: 'window', obj: window });
    for (var r = 0; r < roots.length; r++) {
      var keys;
      try { keys = Object.keys(roots[r].obj); } catch (_) { continue; }
      var names = [];
      // 主应用那个客户端签出来的是短签名，服务端不认，跳过。
      for (var k = 0; k < keys.length; k++) { if (keys[k].indexOf('webpackChunk') === 0 && keys[k] !== 'webpackChunkark_app_root') { names.push(keys[k]); } }
      names.sort(function (a, b) { return (a === 'webpackChunkitemark' ? 0 : 1) - (b === 'webpackChunkitemark' ? 0 : 1); });
      for (var n = 0; n < names.length; n++) {
        var req;
        try { req = xhsChunkRequire(roots[r].obj[names[n]]); } catch (_) { req = null; }
        if (!req) { continue; }
        var found = null;
        try { found = xhsClientIn(req, roots[r].where + '.' + names[n]); } catch (_) { found = null; }
        if (found) { xhsClientCache = found; return found; }
      }
    }
    return null;
  }

  // 裸 fetch 兜底：一个签名头都不带，只有 `search_item_v2` 认。
  function xhsPost(path, body) {
    var token = '';
    try { token = localStorage.getItem('ark-access-token') || ''; } catch (_) {}
    return fetch(path, {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json', authorization: token },
      body: JSON.stringify(body || {})
    }).then(function (res) {
      return res.text().then(function (text) {
        var json;
        try { json = JSON.parse(text); } catch (_) { throw new Error(path + ' 返回的不是 JSON（HTTP ' + res.status + '）：' + text.slice(0, 120)); }
        if (!res.ok) { throw new Error(path + ' HTTP ' + res.status); }
        return json;
      });
    });
  }
  // 两条路回来的形状不一样：子应用客户端已经把 `data` 剥掉了（`publish_render`
  // 剥完还是一段字符串），裸 fetch 是整个 `{code, success, data}`。这里统一成
  // 「就是 data」。
  function xhsUnwrap(r, path) {
    var v = r;
    if (typeof v === 'string') {
      try { v = JSON.parse(v); } catch (_) { throw new Error(path + ' 返回的不是 JSON：' + v.slice(0, 120)); }
    }
    if (v && typeof v === 'object' && v.data !== undefined && (v.success !== undefined || v.code !== undefined)) {
      if (v.success === false && v.code !== 0 && v.code !== 200) { throw new Error(path + ' ' + v.code + '：' + (v.msg || '接口没成')); }
      v = v.data;
      if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) {} }
    }
    return v;
  }
  function xhsCall(path, body) {
    var found = xhsFindClient();
    if (found) {
      return new Promise(function (resolve, reject) {
        var p;
        try { p = found.client.post(path, body || {}, { transform: false }); } catch (e) { reject(e); return; }
        Promise.resolve(p).then(function (r) {
          try { resolve(xhsUnwrap(r, path)); } catch (e) { reject(e); }
        }, reject);
      });
    }
    return xhsPost(path, body).then(function (json) { return xhsUnwrap(json, path); });
  }
  function xhsClientPath() { var f = xhsFindClient(); return f ? f.path : 'fetch(no-sign)'; }
  function xhsErr(e) {
    if (!e) { return '未知错误'; }
    var msg = (e.message !== undefined) ? String(e.message) : String(e);
    if (e.code !== undefined && e.code !== null && msg.indexOf(String(e.code)) < 0) { msg = e.code + '：' + msg; }
    return msg;
  }

  // 分 → 元。整数不带小数。
  function xhsYuan(cents) {
    var n = Number(cents);
    if (!isFinite(n)) { return ''; }
    var y = n / 100;
    return (Math.round(y * 100) === Math.round(y) * 100) ? String(Math.round(y)) : String(Math.round(y * 100) / 100);
  }
  function xhsRange(lo, hi) {
    var has = function (v) { return v !== undefined && v !== null && v !== ''; };
    if (has(lo) && has(hi)) { return String(lo) === String(hi) ? xhsYuan(lo) : (xhsYuan(lo) + ' ~ ' + xhsYuan(hi)); }
    if (has(lo)) { return xhsYuan(lo); }
    if (has(hi)) { return xhsYuan(hi); }
    return '';
  }
  function xhsImg(im) {
    if (!im) { return ''; }
    var u = (typeof im === 'object') ? (im.link || im.url || im.sourceLink || '') : im;
    u = String(u || '');
    if (u === '') { return ''; }
    if (u.indexOf('//') === 0) { return 'https:' + u; }
    return u.indexOf('http://') === 0 ? ('https://' + u.slice(7)) : u;
  }
  function xhsPushImgs(list, imgs, seen) {
    var arr = jdIsArray(list) ? list : [];
    for (var i = 0; i < arr.length; i++) { var u = xhsImg(arr[i]); if (u && !seen[u]) { seen[u] = 1; imgs.push(u); } }
  }
  // 清单里的属性（已经是 name:value）。
  function xhsAttrs(it) {
    var out = [];
    var arr = jdIsArray(it.attributes) ? it.attributes : [];
    for (var i = 0; i < arr.length; i++) {
      var a = arr[i] || {};
      var val = a.attribute_value;
      if ((val === undefined || val === null || val === '') && jdIsArray(a.attribute_value_list)) {
        var xs = [];
        for (var j = 0; j < a.attribute_value_list.length; j++) { var v = a.attribute_value_list[j]; xs.push((v && (v.value || v.attribute_value || v.name)) || v); }
        val = xs.filter(Boolean).join('、');
      }
      if (a.attribute_name && val !== undefined && val !== null && String(val) !== '') { out.push(String(a.attribute_name) + ': ' + String(val)); }
    }
    return out;
  }
  // publish_render 里的属性：`properties[].{propertyName, propertyValueList[].value}`。
  // 只取商品自己填了的，类目候选不碰。
  function xhsRenderAttrs(props) {
    var out = [];
    var arr = jdIsArray(props) ? props : [];
    for (var i = 0; i < arr.length; i++) {
      var p = arr[i] || {};
      var name = p.propertyName || p.property_name || '';
      var vals = [];
      var vl = jdIsArray(p.propertyValueList) ? p.propertyValueList : (jdIsArray(p.property_value_list) ? p.property_value_list : []);
      for (var j = 0; j < vl.length; j++) {
        var v = vl[j];
        var s = (v && typeof v === 'object') ? (v.value || v.name || v.valueName || '') : v;
        if (s !== undefined && s !== null && String(s).trim() !== '') { vals.push(String(s).trim()); }
      }
      if (!vals.length && p.propertyValue !== undefined && p.propertyValue !== null && String(p.propertyValue) !== '') { vals.push(String(p.propertyValue)); }
      if (String(name).trim() !== '' && vals.length) { out.push(String(name).trim() + ': ' + jdUnique(vals).join('、')); }
    }
    return out;
  }
  // 一个 SKU 一行：规格（`skuVariantInfos[]` 的 name value，没有就 skuName）　价格　库存。
  function xhsSkuLines(skus) {
    var lines = [];
    var arr = jdIsArray(skus) ? skus : [];
    for (var i = 0; i < arr.length; i++) {
      var sk = arr[i] || {};
      var parts = [];
      var vs = jdIsArray(sk.skuVariantInfos) ? sk.skuVariantInfos : (jdIsArray(sk.variants) ? sk.variants : []);
      for (var j = 0; j < vs.length; j++) {
        var v = vs[j] || {};
        var vn = v.variantName || v.name || v.propertyName || '';
        var vv = v.variantValue || v.value || v.valueName || v.propertyValue || '';
        if (vv && typeof vv === 'object') { vv = vv.value || vv.name || ''; }
        if (String(vv) !== '') { parts.push((vn ? String(vn) + ' ' : '') + String(vv)); }
      }
      var cell = parts.length ? parts.join('　') : (sk.skuName ? String(sk.skuName) : '默认规格');
      var price = (sk.basePriceInfo && sk.basePriceInfo.price !== undefined) ? sk.basePriceInfo.price : sk.price;
      if (price !== undefined && price !== null && String(price) !== '') { cell += '　价格 ' + xhsYuan(price); }
      var stock;
      if (sk.stock !== undefined && sk.stock !== null) { stock = sk.stock; }
      else if (jdIsArray(sk.baseStockInfos)) {
        var sum = 0, any = false;
        for (var q = 0; q < sk.baseStockInfos.length; q++) { var st = Number(sk.baseStockInfos[q] && sk.baseStockInfos[q].stock); if (isFinite(st)) { sum += st; any = true; } }
        if (any) { stock = sum; }
      }
      if (stock !== undefined) { cell += '　库存 ' + stock; }
      if (sk.barcode && !sk.barcodeAutoGenerated) { cell += '　条码 ' + sk.barcode; }
      lines.push(cell);
    }
    return lines;
  }
  // 尺码表。2026-09-13 真机（一条男装西裤）看清了形状：
  //
  // - `sizeTable.sizeTableConfig.{sizeTable,recommendSizeTable,modelTryOnSizeTable}`
  //   是**类目候选**（可选的表头 `header` + `variantIds`），一条不取。
  // - 商家填的在 `item.standardSizeTableInfo.<同名三张>`：`sizeTableParams` 是
  //   他选的列（`["身高(cm)","体重(kg)"]`），`configSizeTableInfo` 是行，每行
  //   `["xl","175-180","65-70"]` —— 第一格是尺码名，后面按列对齐。还可能带
  //   一张 `sizeTableImage`（商家上传的尺码表图）。
  //
  // 三张表：`sizeTable`（尺码 ↔ 胸围/肩宽…）、`recommendSizeTable`（身高体重
  // 推荐尺码）、`modelTryOnSizeTable`（模特试穿）。表头由页面给，不写死。
  var XHS_SIZE_TABLES = [
    ['sizeTable', ''],
    ['recommendSizeTable', '推荐尺码'],
    ['modelTryOnSizeTable', '模特试穿']
  ];
  function xhsCellText(v) {
    if (v === undefined || v === null) { return ''; }
    if (typeof v === 'object') { return String(v.value || v.name || v.text || '').trim(); }
    return String(v).trim();
  }
  function xhsSizeLines(info) {
    var out = { lines: [], err: '', image: '' };
    if (!info || typeof info !== 'object') { return out; }
    var odd = [];
    for (var t = 0; t < XHS_SIZE_TABLES.length; t++) {
      var key = XHS_SIZE_TABLES[t][0], label = XHS_SIZE_TABLES[t][1];
      var tb = info[key];
      if (!tb || typeof tb !== 'object') { continue; }
      if (!out.image && tb.sizeTableImage) { out.image = xhsImg(tb.sizeTableImage); }
      var rows = jdIsArray(tb.configSizeTableInfo) ? tb.configSizeTableInfo : [];
      if (!rows.length) { continue; }
      if (!jdIsArray(rows[0])) { odd.push(key + ':' + Object.prototype.toString.call(rows[0])); continue; }
      var params = jdIsArray(tb.sizeTableParams) ? tb.sizeTableParams : [];
      var header = ['尺码'];
      for (var p = 0; p < params.length; p++) { var h = xhsCellText(params[p]); if (h !== '') { header.push(h); } }
      out.lines.push('  ' + (label ? label + '：' : '') + header.join('　'));
      for (var r = 0; r < rows.length; r++) {
        var cells = [];
        var row = jdIsArray(rows[r]) ? rows[r] : [rows[r]];
        for (var c = 0; c < row.length; c++) { cells.push(xhsCellText(row[c])); }
        out.lines.push('  ' + cells.join('　'));
      }
    }
    if (odd.length) { out.err = '尺码表的行不是数组：' + odd.join('，'); }
    return out;
  }

  function xhsBriefOf(it) {
    var imgs = [], seen = {};
    xhsPushImgs(it.images, imgs, seen);
    var id = String(it.item_id || it.id || '');
    return {
      title: String(it.item_name || it.item_name_with_brand_name || '').trim(),
      itemId: id,
      price: xhsRange(it.min_price, it.max_price),
      thumb: imgs[0] || '',
      alias: '',
      images: imgs,
      itemHref: id ? ('https://ark.xiaohongshu.com/app-item/good/edit/' + id) : '', // gate-allow: 千帆商品编辑页固定前缀，只当链接用，不发请求
      itemStatus: null
    };
  }

  ops.xhsApiList = function (args) {
    var a = args || {};
    var pageSize = Number(a.pageSize) > 0 ? Math.min(Number(a.pageSize), 50) : 20;
    var maxPages = Number(a.maxPages) > 0 ? Math.min(Number(a.maxPages), 100) : 100;
    var pageDelay = Number(a.pageDelay) >= 0 ? Number(a.pageDelay) : 400;
    var cardType = Number(a.cardType) > 0 ? Number(a.cardType) : 2;
    var items = [], seen = {}, pages = 0, declared = 0;

    function body(n) {
      return { page_no: n, page_size: pageSize, search_order: { sort_field: 'create_time', order: 'desc' }, search_filter: { card_type: cardType, is_channel: false }, search_item_detail_option: XHS_DETAIL_OPTION };
    }
    function step(n) {
      if (n > maxPages) { return Promise.resolve(); }
      return xhsCall(XHS_LIST_API, body(n)).then(function (d) {
        pages += 1;
        d = d || {};
        if (n === 1) { declared = Number(d.total) || 0; }
        var rows = jdIsArray(d.items) ? d.items : [];
        var fresh = 0;
        for (var i = 0; i < rows.length; i++) {
          var b = xhsBriefOf(rows[i] || {});
          if (b.title === '') { continue; }
          var key = b.itemId !== '' ? b.itemId : b.title;
          if (Object.prototype.hasOwnProperty.call(seen, key)) { continue; }
          seen[key] = 1; fresh += 1; items.push(b);
        }
        if (fresh === 0) { return; }
        if (rows.length < pageSize) { return; }
        if (declared > 0 && items.length >= declared) { return; }
        return jdSleep(pageDelay).then(function () { return step(n + 1); });
      });
    }
    return step(1).then(function () {
      return { ok: true, items: items, pages: pages, declared: declared, clientPath: xhsClientPath() };
    }, function (e) {
      return { ok: false, reason: xhsErr(e), clientPath: xhsClientPath(), items: [] };
    });
  };

  // 详情兜底：清单按 `item_ids:[id]` 精确取一件（真机确认这个过滤键生效）。
  // 先 card_type 3（含下架）再 2。没有 SKU 明细和描述。
  function xhsDetailFromList(id) {
    function look(cardType) {
      return xhsCall(XHS_LIST_API, { page_no: 1, page_size: 20, search_filter: { item_ids: [id], card_type: cardType, is_channel: false }, search_item_detail_option: XHS_DETAIL_OPTION })
        .then(function (d) {
          var rows = (d && jdIsArray(d.items)) ? d.items : [];
          for (var i = 0; i < rows.length; i++) { if (String(rows[i].item_id || rows[i].id || '') === id) { return rows[i]; } }
          return null;
        });
    }
    return look(3).then(function (it) { return it || look(2); }).then(function (it) {
      if (!it) { return { ok: false, reason: '按 id 查不到这件商品', clientPath: xhsClientPath() }; }
      var lines = [];
      var cats = jdIsArray(it.categories) ? it.categories : [];
      var path = [];
      for (var c = 0; c < cats.length; c++) { var nm = cats[c] && cats[c].name; if (typeof nm === 'string' && nm.trim() !== '') { path.push(nm.trim()); } }
      if (path.length) { lines.push('商品类目: ' + path.join(' > ')); }
      var attrs = xhsAttrs(it);
      for (var ai = 0; ai < attrs.length; ai++) { lines.push(attrs[ai]); }
      var price = xhsRange(it.min_price, it.max_price);
      var skuN = Number(it.sku_count) || 0;
      if (skuN > 0 || price !== '') {
        var seg = [];
        if (price !== '') { seg.push('价格 ' + price); }
        if (skuN > 0) { seg.push('共 ' + skuN + ' 个规格'); }
        if (it.total_stock !== undefined && it.total_stock !== null) { seg.push('库存合计 ' + it.total_stock); }
        if (seg.length) { lines.push('规格与价格：'); lines.push('  ' + seg.join('　')); }
      }
      var imgs = [], seen = {};
      xhsPushImgs(it.images, imgs, seen);
      return {
        ok: true,
        attrsText: lines.join('\n'),
        desc: typeof it.description === 'string' ? it.description.trim() : '',
        images: imgs,
        title: String(it.item_name || '').trim(),
        attrCount: attrs.length,
        propCount: jdIsArray(it.attributes) ? it.attributes.length : 0,
        sizeRows: 0,
        skuCount: skuN,
        unresolved: [],
        skuErr: skuN > 1 ? '清单没有逐规格明细，只有规格数' : '',
        detailErr: '',
        sizeErr: '',
        clientPath: xhsClientPath()
      };
    });
  }

  function xhsDetailFromRender(id, d) {
    d = d || {};
    var errs = jdIsArray(d.errors) ? d.errors : [];
    var errText = [];
    for (var e = 0; e < errs.length; e++) { var er = errs[e]; var em = (er && typeof er === 'object') ? (er.msg || er.message || '') : er; if (em) { errText.push(String(em)); } }
    var pd = (d.product && d.product.productDetail) || {};
    var item = pd.item || {};
    var skus = jdIsArray(pd.skuList) ? pd.skuList : [];
    var lines = [];

    // 类目路径。
    var cp = jdIsArray(item.categoryPath) ? item.categoryPath : [];
    var path = [];
    for (var c = 0; c < cp.length; c++) { var nm = cp[c] && (cp[c].categoryName || cp[c].name); if (typeof nm === 'string' && nm.trim() !== '') { path.push(nm.trim()); } }
    if (path.length) { lines.push('商品类目: ' + path.join(' > ')); }
    // 属性。
    var attrs = xhsRenderAttrs(item.properties);
    for (var ai = 0; ai < attrs.length; ai++) { lines.push(attrs[ai]); }
    // SKU。
    var skuLines = xhsSkuLines(skus);
    if (skuLines.length) { lines.push('规格与价格：'); for (var s = 0; s < skuLines.length; s++) { lines.push('  ' + skuLines[s]); } }
    // 尺码表。
    var size = xhsSizeLines(item.standardSizeTableInfo);
    if (size.lines.length) { lines.push('尺码表：'); for (var z = 0; z < size.lines.length; z++) { lines.push(size.lines[z]); } }

    // 图：主图、长图、详情图。
    var imgs = [], seen = {};
    xhsPushImgs(item.images, imgs, seen);
    xhsPushImgs(item.longImages, imgs, seen);
    xhsPushImgs(item.standardImages, imgs, seen);
    xhsPushImgs(item.imageDescriptions, imgs, seen);
    if (size.image && !seen[size.image]) { seen[size.image] = 1; imgs.push(size.image); }
    var desc = typeof item.description === 'string' ? item.description.trim() : '';

    return {
      ok: true,
      attrsText: lines.join('\n'),
      desc: desc,
      images: imgs,
      title: String(item.itemName || item.name || '').trim(),
      attrCount: attrs.length,
      propCount: jdIsArray(item.properties) ? item.properties.length : 0,
      sizeRows: size.lines.length,
      skuCount: skuLines.length,
      unresolved: [],
      skuErr: '',
      detailErr: errText.join('；'),
      sizeErr: size.err,
      clientPath: xhsClientPath()
    };
  }

  ops.xhsApiDetail = function (args) {
    var a = args || {};
    var id = String(a.productId || a.itemId || '').trim();
    if (id === '') { return Promise.resolve({ ok: false, reason: '没有给出商品 id' }); }
    if (!xhsFindClient()) {
      // 没有子应用客户端就签不了名，publish_render 必 406，直接走清单那条。
      return xhsDetailFromList(id).then(function (r) {
        if (r && r.ok) { r.detailErr = '没找到 itemark 子应用的客户端，publish_render 没发，只有清单里的信息'; }
        return r;
      }, function (e) { return { ok: false, reason: xhsErr(e), clientPath: xhsClientPath() }; });
    }
    return xhsCall(XHS_RENDER_API, { data: JSON.stringify({ publishType: 2, sourceType: 1, itemId: id }) })
      .then(function (d) { return xhsDetailFromRender(id, d); })
      .then(null, function (e) {
        var why = xhsErr(e);
        return xhsDetailFromList(id).then(function (r) {
          if (r && r.ok) { r.detailErr = 'publish_render 没通（' + why + '），退到清单取值'; }
          return r;
        }, function (e2) { return { ok: false, reason: 'publish_render 没通（' + why + '），清单兜底也没成（' + xhsErr(e2) + '）', clientPath: xhsClientPath() }; });
      });
  };

  // ---- 商家后台的商品表格（抖店 / 京麦 / 拼多多共用）----------------------
  //
  // # 与千牛那组 op 的区别
  //
  // 千牛那几个（`qianniuReadPage` 等）是**按选择器取每一列**：画像里给
  // `rowTitle` / `rowPrice` / `rowStatus`，页面上各自 query 一次。那对千牛
  // 成立，因为它的列有语义类名。
  //
  // 三个商家后台不成立，2026-08-31 真机量的三件事各否掉一种写法：
  //
  //   1. **列序三家不同** —— 价格在拼多多是第 2 列，在京麦是第 4 列；
  //      而且商家后台的列常常可配置、可隐藏，按下标写死必然错
  //   2. **类名带组件库版本号** —— 拼多多现在是 `PGT_totalText_5-188-0`，
  //      老工程写死的是 `5-161-0`，已经变过一次
  //   3. **拼多多每一列类名都一样**（`TB_td_…`），压根没有按列区分的语义
  //
  // 所以这里改成**按表头文字认列**：读一次 `thead`，把「价格(元)」这种中文
  // 对到我们的语义名上，再按那个下标取单元格。表头不随组件库版本变、
  // **也不随品类变** —— 最后这条要紧：商家覆盖全品类，任何针对某一品类写死
  // 的字段名都是缺陷。

  // 表头在哪。
  //
  // **不能只看 `thead`**：虚拟表格常把表头单独渲染在表体外面（抖店就是
  // `ecom-g-table-header` 一个独立容器）。找不到表头时返回空数组，由上层
  // 报「认不出列」—— 那与「表里没有商品」必须分开。
  function headerCells(row) {
    var table = row.closest ? row.closest('table') : null;
    var cells = [];
    if (table) {
      cells = Array.prototype.slice.call(table.querySelectorAll('thead th, thead td'));
      if (cells.length) { return cells; }
    }
    // 表头被渲染在别处：从行往上找一个共同祖先，再在里面找 header 容器。
    var box = row;
    for (var up = 0; box && up < 6; up++) {
      var h = box.querySelector
        ? box.querySelector('[class*="table-header"], [class*="TableHeader"], thead')
        : null;
      if (h) {
        cells = Array.prototype.slice.call(h.querySelectorAll('th, td'));
        if (cells.length) { return cells; }
      }
      box = box.parentElement;
    }
    return [];
  }

  // 表头文字 → 我们的语义名，按候选列表匹配。
  //
  // **用「包含」而不是「相等」**：真机上表头里常常混着别的东西
  // （拼多多是「价格(元) 批量修改」、「商品信息 批量修改标题」），
  // 而那些是按钮，不是列名的一部分。
  function mapColumns(cells, columns) {
    var map = {};
    var texts = [];
    for (var i = 0; i < cells.length; i++) {
      texts.push((cells[i].innerText || cells[i].textContent || '').replace(/\s+/g, ' ').trim());
    }
    for (var name in columns) {
      if (!Object.prototype.hasOwnProperty.call(columns, name)) { continue; }
      var cands = columns[name] || [];
      var best = -1;
      // **候选按顺序试，先命中的赢** —— 画像里把最具体的排前面
      // （「价格(元)」在「价格」前面），否则「价格」会先中一个别的列。
      for (var c = 0; c < cands.length && best === -1; c++) {
        var want = String(cands[c]);
        if (want === '') { continue; }
        for (var t = 0; t < texts.length; t++) {
          if (texts[t].indexOf(want) !== -1) { best = t; break; }
        }
      }
      if (best !== -1) { map[name] = best; }
    }
    return { map: map, headers: texts };
  }

  // 从一行里取商品 id。
  //
  // **属性优先**：属性上的 id 是干净的（抖店 `data-row-key`），而从行文本里
  // 抠要跟着平台的措辞走 —— 京麦是「商品编码：」，拼多多是「ID: 」，
  // 连冒号的全角半角都不一样。
  function rowItemId(row, attr, prefixes) {
    if (attr) {
      var v = row.getAttribute(attr);
      if (v && String(v).trim() !== '') { return String(v).trim(); }
    }
    var text = (row.innerText || '').replace(/\s+/g, ' ');
    for (var i = 0; i < (prefixes || []).length; i++) {
      var p = String(prefixes[i]);
      if (p === '') { continue; }
      var at = text.indexOf(p);
      if (at === -1) { continue; }
      // v25（2026-09-05）：id 不一定是纯数字。小红书的商品 id 是 24 位十六进制
      // （`商品ID: 6a033fb2273c7d000119b2fc`），原先只认 `[0-9]{6,}`，抠出来是
      // 空串 —— 这件商品从此「没有 id」，学习时被判成 BriefOnly，只剩标题价格。
      // 放宽到字母数字，但**至少含一个数字**：纯字母的词（「商品货号」后面的
      // 说明文字之类）不该被当成 id。
      var m = /(?=[0-9A-Za-z_-]*[0-9])[0-9A-Za-z_-]{6,}/.exec(text.slice(at + p.length, at + p.length + 40));
      if (m) { return m[0]; }
    }
    return '';
  }

  // 去掉阿里云 OSS 那种「按需缩放」的查询参数（`?x-oss-process=image/resize,…`）。
  //
  // v24（2026-09-05）：快手的清单缩略图与编辑页详情图**全部带着这个参数**
  // （`w_96,h_96` / `w_156,h_156`），页面为了省流量按显示尺寸要图。原样收下
  // 的后果是：素材库里存的是 96px 的糊图，多模态拿到的是 156px 的详情图 ——
  // 尺码表在上面一个字都读不出来，而「学完了」看起来一切正常。
  //
  // 这个参数只做缩放，去掉就是原图（真机 HEAD 过：去掉之后 200、还是图）。
  // 别的平台的地址里没有它，原样返回。**只认这几个参数名**，不动别的查询串。
  //
  // v25（2026-09-05）：小红书用的是七牛那套 —— 整个查询串就是缩放指令
  // （`?imageView2/2/w/140/format/webp/q/75`，2.7KB 的 webp；去掉之后是
  // 280KB 的原图，真机 HEAD 过）。`imageMogr2` 是同一家的另一个指令名。
  function stripOssResize(u) {
    var s = String(u || '');
    if (s.indexOf('x-oss-process=') === -1 && !/\?(imageView2|imageMogr2)\//.test(s)) { return s; }
    try {
      var url = new URL(s, location.href);
      if (/^\?(imageView2|imageMogr2)\//.test(url.search)) {
        url.search = '';
      } else {
        url.searchParams.delete('x-oss-process');
      }
      return url.href;
    } catch (e) {
      return s;
    }
  }

  // 行里那张商品图。**跳过 data: 与小图标** —— 行里除了商品图还有各种角标。
  function rowThumb(row) {
    var imgs = row.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      var u = imgs[i].getAttribute('src') || imgs[i].getAttribute('data-src') || '';
      if (u === '' || u.indexOf('data:') === 0) { continue; }
      var r = imgs[i].getBoundingClientRect();
      if (r.width < 24 || r.height < 24) { continue; }
      return stripOssResize(u);
    }
    return '';
  }

  // 「共 N 条」里那个数。取**第一串数字**。
  function totalFrom(text) {
    var m = /([0-9][0-9,]*)/.exec(String(text || ''));
    if (!m) { return null; }
    var n = Number(m[1].replace(/,/g, ''));
    return isFinite(n) ? n : null;
  }

  // 一格的文本。**跳过操作按钮那一支。**
  //
  // 表格的每一格里除了数据，常常还挂着这一行的操作（拼多多的价格格里是
  // 一个「修改价格」，抖店/京东的行尾是「编辑」「下架」）。整格 innerText
  // 读下来就成了「59 修改价格」—— 那个价格会一路存进知识库，再被 AI 当
  // 事实说给买家听（2026-09-01 真机）。
  //
  // 用 TreeWalker 而不是先克隆再删：克隆下来的节点没有排版，innerText 会
  // 退化成 textContent，空白与换行的处理和线上不一样。REJECT 一个元素会
  // 连它整棵子树一起跳过，正好是要的。
  function textSkippingActions(cell) {
    var out = [];
    var w = document.createTreeWalker(cell, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (n.nodeType === 1) {
          if (isAction(n)) { return NodeFilter.FILTER_REJECT; }
          // **只收渲染出来的文字。**
          //
          // 这一条是补上 `innerText` 原本免费提供的东西。换成 TreeWalker
          // 之后它没了，2026-09-01 真机上立刻出了两样：
          //
          //   预览 .beast-core-ellipsis-2{-webkit-line-clamp:2;…} 与狼共舞裤子2…
          //
          // 「预览」是悬停才显示的浮层，那段大括号是单元格里一个 <style>
          // 标签的内容 —— 两样都不渲染，而 `innerText` 从来不会返回它们。
          // 商品名就这么变成了一段 CSS。
          if (!isRendered(n)) { return NodeFilter.FILTER_REJECT; }
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while (w.nextNode()) {
      var n = w.currentNode;
      if (n.nodeType === 3) { out.push(n.nodeValue || ''); }
    }
    return out.join(' ').replace(/\s+/g, ' ').trim();
  }

  // 这个元素是「操作」不是「数据」吗。
  //
  // 只认标签与 role，**不按类名猜**：类名里带 btn 的东西五花八门，误判会
  // 把真数据整块吞掉，而那种丢失是静默的。认不出来的（比如挂了点击事件的
  // 裸 span）交给 Rust 那边的价格提取兜底。
  // 这个元素**渲染出来了吗**。
  //
  // 先看有没有矩形 —— 那一步不触发额外的排版，`getClientRects` 读的是已有
  // 的布局。没有矩形**不一定是隐藏**：`display: contents` 的元素自己不生成
  // 盒子，孩子照样渲染。只有在没矩形的时候才多问一次 computed style，
  // 那是罕见分支，代价可以忽略。
  //
  // `<style>` / `<script>` 天生 `display: none`，这一条顺带把它们挡在外面；
  // 但仍然显式列出来 —— 有的页面会把 CSS 显示给人看（`style { display: block }`），
  // 那时候矩形是有的，而它照样不是数据。
  function isRendered(el) {
    var tag = (el.tagName || '').toUpperCase();
    if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') {
      return false;
    }
    if (el.getClientRects && el.getClientRects().length > 0) { return true; }
    try { return window.getComputedStyle(el).display === 'contents'; } catch (e) { return true; }
  }

  function isAction(el) {
    var tag = (el.tagName || '').toUpperCase();
    if (tag === 'BUTTON' || tag === 'A' || tag === 'SELECT' || tag === 'TEXTAREA') { return true; }
    return el.getAttribute && el.getAttribute('role') === 'button';
  }

  ops.readSellerTable = function (args) {
    var a = args || {};
    var sel = a.selectors || {};
    var columns = a.columns || {};

    var rows = queryTwoLevel(document, sel.tableRow);
    if (rows.length === 0) {
      // **「一行都没有」不等于「这家店没商品」。** 还没登录、还没加载完、
      // 平台改版，三种都长这样。把判断交给 Rust，这里只如实报。
      return { items: [], rows: 0, total: totalFrom(textOf(document, sel.totalText)),
               headers: [], columnMap: {}, missingColumns: Object.keys(columns) };
    }

    var mapped = mapColumns(headerCells(rows[0]), columns);
    var map = mapped.map;
    var missing = [];
    for (var name in columns) {
      if (Object.prototype.hasOwnProperty.call(columns, name) && !(name in map)) { missing.push(name); }
    }

    function cellText(cells, name) {
      var idx = map[name];
      if (idx === undefined || !cells[idx]) { return ''; }

      // **这一列配了「值在哪」就只读那一处。**
      //
      // 整格读会把徽标、编码、营销提示一起收进来 —— 京东的商品信息格里是
      // 「信息分 91 …商品编码：… 2个SKU」，价格格里是「¥99999.00 2个SKU
      // 调价提曝光」（2026-09-01 真机探针）。跳过按钮那一支挡不住它们：
      // 那些不是按钮，是同一格里的别的信息。
      var vs = (a.cellValue || {})[name];
      if (vs) {
        var hit = queryTwoLevel(cells[idx], vs);
        if (hit.length > 0) {
          var only = tidyTitle(hit[0].innerText);
          if (only !== '') { return only; }
          // 配了却读不出东西：**要出声**。静默退回整格的话，选择器随平台
          // 改版失效时，脏数据会重新长回来而没有任何迹象 —— 而它长的样子
          // （「信息分 91 男士休闲…」）恰恰读得通，没人会怀疑。
          alarm('列「' + name + '」配了 cellValue，选择器命中了却读不出文字 —— 它可能已随平台改版失效');
        }
      }

      var t = textSkippingActions(cells[idx]);
      if (t !== '') { return t; }
      // 整格都被跳过了（一格里只有按钮），退回原样读一次 —— 宁可多读，
      // 不要静默地把一格读成空。
      return (cells[idx].innerText || cells[idx].textContent || '').replace(/\s+/g, ' ').trim();
    }

    var items = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var cells = row.querySelectorAll('td');
      // 高度为 0 的测量行（抖店的 `ecom-g-table-measure-row`）没有单元格。
      if (cells.length === 0) { continue; }
      var title = cellText(cells, 'title');
      // 标题那一格里常常还带着 id、编码、标签。**取第一行文本**：真机上
      // 商品名总是排在最前面，而后面那些是「ID: …」「商品编码: …」。
      var firstLine = title.split(' ID')[0].split(' 商品编码')[0].trim();
      if (firstLine !== '') { title = firstLine; }
      if (title === '') { continue; }
      items.push({
        title: title,
        itemId: rowItemId(row, String(a.rowIdAttr || ''), a.rowIdPrefixes || []),
        price: cellText(cells, 'price'),
        thumb: rowThumb(row),
        itemHref: '',
        images: [],
        status: cellText(cells, 'status')
      });
    }

    return {
      items: items,
      rows: rows.length,
      total: totalFrom(textOf(document, sel.totalText)),
      headers: mapped.headers,
      columnMap: map,
      missingColumns: missing
    };
  };

  // 点页面自己的「下一页」。
  //
  // # 为什么我们来点，而不是让商家点
  //
  // 我们点的是页面自己的按钮，触发的是它自己的事件处理器 —— 发出去的请求
  // （签名、请求头、Referer、Cookie）与真人点击**逐字节相同**，平台在服务端
  // 区分不出是谁点的。它能看出差别的只有时序，而那是 Rust 侧 `jittered_ms`
  // 管的事，不是「谁来点」管的事。
  //
  // # 到底了要认得出来
  //
  // 三家都是在 `li`/`button` 上加一个带 `disabled` 的类（抖店
  // `ecom-g-pagination-disabled`、拼多多 `PGT_disabled_…`）或 `disabled` 属性。
  // **认不出来的后果是一直点一个不动的按钮**，而每一轮都要等一次超时。
  ops.clickNextPage = function (args) {
    var a = args || {};
    var hits = queryTwoLevel(document, a.selectors);
    if (hits.length === 0) { return { clicked: false, why: 'no-button' }; }
    var el = hits[0];
    // 往上看三层有没有禁用标记 —— 按钮本身常常是好的，禁用挂在外面那个 li 上。
    var node = el;
    for (var up = 0; node && up < 3; up++) {
      var cls = typeof node.className === 'string' ? node.className : '';
      if (/disabled/i.test(cls) || node.disabled === true ||
          (node.getAttribute && node.getAttribute('aria-disabled') === 'true')) {
        return { clicked: false, why: 'disabled' };
      }
      node = node.parentElement;
    }
    try {
      el.click();
    } catch (e) {
      return { clicked: false, why: 'click-failed: ' + String((e && e.message) || e) };
    }
    return { clicked: true };
  };

  // 把「每页 N 条」调大。
  //
  // **这是降风险最有效的一步**：300 件商品从 30 次交互降到 3 次。一次采集在
  // 平台眼里像不像正常操作，取决于它一共产生了多少次动作 —— 而不是那几次
  // 动作由谁发起。
  //
  // 调不动就照默认值走，**不当失败**：少调一次只是慢，而为它中断整次采集是
  // 拿商家的时间换我们的洁癖。
  //
  // 形状是「点开当前值 → 在弹出的选项里找那一档 → 点它」。三家都是这个形状
  // （抖店/京麦是 select 风格的下拉，拼多多待探）。
  ops.setPageSize = function (args) {
    var a = args || {};
    var want = String(a.optionText || '');
    if (want === '') { return { changed: false, why: 'not-configured' }; }
    var ctl = queryTwoLevel(document, a.selectors)[0];
    if (!ctl) { return { changed: false, why: 'no-control' }; }
    var now = (ctl.innerText || ctl.value || '').trim();
    if (now.indexOf(want) !== -1) { return { changed: false, why: 'already', current: now }; }
    try { ctl.click(); } catch (e) { return { changed: false, why: 'open-failed' }; }
    // 选项是点开之后才渲染的。先找**已经在 DOM 里**的那些。
    var seen = 0;
    function pick() {
      var opts = document.querySelectorAll(
        '[class*="select-item-option"], [class*="option-content"], li[role="option"], [role="option"]'
      );
      seen = opts.length;
      for (var i = 0; i < opts.length; i++) {
        var t = (opts[i].innerText || '').trim();
        if (t.indexOf(want) === -1) { continue; }
        try { opts[i].click(); } catch (e) { continue; }
        return { changed: true, from: now, to: t };
      }
      return null;
    }
    var hit = pick();
    if (hit) { return hit; }
    // v24（2026-09-05）：**`click()` 点不开的下拉，补一次 mousedown。**
    //
    // 抖店/京麦的下拉点一下就开；快手用的 antd v5 的 rc-select 只听
    // `mousedown`，合成的 click 事件它根本不理 —— 真机上 `ctl.click()`
    // 之后 DOM 里一个选项都没有，而 mousedown 之后立刻就有了。事件发在
    // 选择器容器上（`…-select-selector`），那才是挂监听的那一层。
    //
    // 选项可能要等一帧才渲染出来，所以 mousedown 之后先同步找一次，没找到
    // 再等 300 毫秒找一次（这个 op 可以返回 Promise，`handle` 会等它）。
    var selector = ctl.closest('[class*="select-selector"]') || ctl.parentElement || ctl;
    try {
      selector.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    } catch (e) { /* 发不出去就按没开处理 */ }
    hit = pick();
    if (hit) { return hit; }
    return new Promise(function (resolve) {
      later(function () {
        var late = pick();
        if (late) { resolve(late); return; }
        // 没有要选的那一档：把下拉关回去，别让它盖着表格。再 mousedown 一次
        // 就是关（rc-select 的开关是同一个事件）。
        try {
          selector.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        } catch (e) { /* 关不掉也不影响读表 */ }
        resolve({ changed: false, why: 'no-option', current: now, seen: seen });
      }, 300);
    });
  };

  // 点某一行的「编辑」按钮。
  //
  // # 为什么要按商品 id 找行，不按下标
  //
  // 调用方手上是一份**读清单时**拿到的商品列表，而学习是之后才发生的 ——
  // 中间商家可能翻过页、搜索过、改过筛选。按下标点等于**点到另一件商品**，
  // 而那件商品会被当成这一件学进知识库：标题对不上，图对不上，而且不报错。
  //
  // 按 id 找不到就明说找不到，由 Rust 决定怎么办（多半是翻回那一页）。
  // 把页面给的地址补成绝对地址。
  //
  // # 为什么必须在页面里做
  //
  // 平台给的编辑页链接常常不是绝对地址。京东给的是**协议相对**地址：
  // `//ware.shop.jd.com/rest/shop/ware/publish3/…` —— 它在 HTML 里完全
  // 合法（继承当前页的 http/https），但交到宿主那边就只是一个不认识的
  // 字符串，被地址校验挡下来，学习**稳定失败**（2026-09-01 真机）。
  //
  // 补基地址只有页面里做得对：正确的 scheme 和 host 就在 `location.href`
  // 上。宿主那边不知道这件商品是从哪个页面点开的，只能猜。
  //
  // `new URL(u, base)` 一次覆盖全部形态：`//host/x`、`/x`、`x`、以及
  // 已经是绝对地址的那些（原样返回）。解不出来就把原值交回去 —— 让宿主
  // 那条校验去报错，比在这里悄悄吞掉强。
  function absolute(u) {
    var raw = String(u);
    try {
      return new URL(raw, document.baseURI || location.href).href;
    } catch (e) {
      return raw;
    }
  }

  // 读一个元素的文字，但跳过：给定的那些元素、表单控件、按钮/链接、
  // 以及此刻看不见的东西。
  //
  // 用来算属性名 —— 那是要交给 AI 当事实读的东西，混进一串下拉候选项或者
  // 一个「点击申请」，比少读一条属性糟得多。
  //
  // 可见性判据复用上面那个 `isRendered`（它还处理了 `display: contents` 与
  // `<style>`/`<script>`）—— **不要在这里再写一个**：同作用域里的函数声明
  // 后者胜出，重复定义会把那个更完善的实现整个替换掉。
  function textOutside(root, skip) {
    var out = '';
    var skipped = [];
    for (var s = 0; s < skip.length; s++) { skipped.push(skip[s]); }
    (function walk(n) {
      for (var i = 0; i < n.childNodes.length; i++) {
        var c = n.childNodes[i];
        if (c.nodeType === 3) { out += c.nodeValue + ' '; continue; }
        if (c.nodeType !== 1) { continue; }
        var tag = (c.tagName || '').toUpperCase();
        if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' ||
            tag === 'TEXTAREA' || tag === 'SELECT') { continue; }
        if (skipped.indexOf(c) !== -1) { continue; }
        if (!isRendered(c)) { continue; }
        walk(c);
      }
    })(root);
    return out;
  }

  // 这个元素里面还有没有一个**文字完全相同**的后代。
  //
  // 有 = 它只是包着真按钮的容器；没有 = 它就是最内层的那个。图标不带文字，
  // 天然不影响判断。展开折叠区那段用的是同一条判据。
  function hasSameTextDescendant(el, text) {
    var inner = el.querySelectorAll('*');
    for (var i = 0; i < inner.length; i++) {
      if ((inner[i].innerText || '').trim() === text) { return true; }
    }
    return false;
  }

  ops.clickRowEdit = function (args) {
    var a = args || {};
    var sel = a.selectors || {};
    var want = String(a.itemId || '').trim();
    if (want === '') { return { clicked: false, why: 'no-item-id' }; }

    var rows = queryTwoLevel(document, sel.tableRow);
    var row = null;
    for (var i = 0; i < rows.length && !row; i++) {
      if (rowItemId(rows[i], String(a.rowIdAttr || ''), a.rowIdPrefixes || []) === want) {
        row = rows[i];
      }
    }
    if (!row) { return { clicked: false, why: 'row-not-found', rows: rows.length }; }

    var texts = a.buttonText || [];
    var els = row.querySelectorAll('a, button, span, div');
    for (var k = 0; k < els.length; k++) {
      var t = (els[k].innerText || '').trim();
      if (texts.indexOf(t) === -1) { continue; }
      // **点最内层那个**：外层容器的 innerText 也等于按钮文字，但点它可能
      // 落在别的地方。事件会冒泡到真正挂处理函数的那一层。
      //
      // v24（2026-09-05）：「最内层」按语义判，不按后代数量。原先是
      // 「后代多于 2 个就跳过」—— 快手的按钮是 `span > button > span`，
      // 外层那个 span 恰好只有 2 个后代，于是点的是它；而点击**只向上冒泡、
      // 不向下传**，button 上的处理函数根本不跑，页面什么都没开，报出来是
      // 「没有要开新窗口」。判据换成与展开折叠区同一条：里面还有文字完全
      // 相同的后代就跳过，剩下的那个才是真按钮（或它里面那个 span，事件会
      // 冒泡上去）。
      if (hasSameTextDescendant(els[k], t)) { continue; }

      // ---- 就着这一下点击，把它想开的地址截下来 ----
      //
      // # 为什么在这里包，而不是靠宿主的新窗口回调
      //
      // 原先靠 wry 的 `with_new_window_req_handler`（页面一个字节不改，更干净）。
      // **真机上它拿不到**：脚本发起的 `click()` 不带「用户激活」，WebView2 的
      // 弹窗拦截会直接吞掉那次 `window.open` —— 连事件都不发。日志里的样子是
      // 「点了「编辑」但抖店没有要开新窗口」，而页面其实调了。
      //
      // 包在这里拦的是**调用**，弹窗被不被拦截都记得到。
      //
      // # 必须透传
      //
      // 把返回值换成 `null` 会当场弄坏页面：拼多多的代码是
      // `window.open(...).location = x`，拿到 null 立刻抛 —— 探针里真栽过一次。
      // 所以原样把宿主的返回值交回去，我们只是在旁边记一笔。
      //
      // # 用完立刻还原
      //
      // 这是本模块第一条纪律（「能不包装就不包装；必须包装就必须完全透明」）
      // 允许的最小形态：**只在这一次点击期间**存在，`finally` 里还回去。
      var captured = null;
      var origOpen = window.open;
      window.open = function (u) {
        try { if (captured === null && u) { captured = absolute(u); } } catch (e) { /* 记不下就算了 */ }
        return origOpen.apply(this, arguments);
      };
      try {
        els[k].click();
      } catch (e) {
        return { clicked: false, why: 'click-failed: ' + String((e && e.message) || e) };
      } finally {
        window.open = origOpen;
      }
      return { clicked: true, label: t, url: captured || '' };
    }
    return { clicked: false, why: 'button-not-found' };
  };

  // 读卖家自己的「编辑商品」页。
  //
  // # 为什么读这里，而不是买家侧商品页
  //
  // 1. **没有反爬** —— 那是商家自己的后台
  // 2. **数据最全** —— 类目、属性、SKU 规格与价格，买家侧有些根本不显示
  // 3. **不用猜** —— 买家页要靠「像不像人话」把描述挑出来；编辑页里字段
  //    是带名字的
  // 4. **没有懒加载的坑** —— 千牛读的买家页就栽在这上面：不滚就读到 0 条
  //    属性和 0 条尺码，而且不报错
  //
  // # 表格连表头一起读，不预设列名
  //
  // 商家覆盖**全品类**。同一个位置在服装是尺码表、3C 是参数表、食品是成分表、
  // 图书是版本信息 —— 写死成「尺码」会让别的品类要么空着、要么被硬塞。
  //
  // 所以这里只做一件事：把页面上的表**原样转成文字**，表头用页面给的那一份。
  // 这与 `ingest::SpecTable`（「名字由模型填，不由我们预设」）是同一条纪律。
  ops.readSellerEditPage = function (args) {
    var a = args || {};
    var sel = a.selectors || {};

    function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

    // ---- 先把盖住表单的弹窗关掉 ----
    //
    // 老工程为抖店处理过两个（「属性自动优化」「商品质量分优化预警」）。
    // **关不掉就照常往下读**：弹窗盖住的是一部分字段，不是全部，为它中断
    // 整件商品不划算。
    var dismissed = [];
    var wants = a.dismissText || [];
    if (wants.length) {
      var clickable = document.querySelectorAll('button, a, [role="button"]');
      for (var d = 0; d < clickable.length && dismissed.length < 3; d++) {
        var dt = clean(clickable[d].innerText);
        if (wants.indexOf(dt) === -1) { continue; }
        // v24（2026-09-05）：**只点看得见的。** 弹窗盖住表单，按钮必然可见；
        // 一个藏着的「知道了」不是弹窗，点它是在替商家确认一件我们看不见的
        // 事（快手编辑页上就有一个收在通知条里的）。
        if (!isRendered(clickable[d])) { continue; }
        try { clickable[d].click(); dismissed.push(dt); } catch (e) { /* 关不掉就算了 */ }
      }
    }

    // ---- 再把折叠起来的属性展开 ----
    //
    // # 为什么这一步不可省
    //
    // 京麦把一部分类目属性收在「其他属性 6/6 展开」后面，而那 6 行**根本
    // 不在 DOM 里** —— 不是隐藏，是还没渲染（真机数过：展开前属性行 21 个，
    // 可见 21、隐藏 0）。不点这一下，那 6 条属性就是不存在的，而且没有任何
    // 迹象表明少了东西。
    //
    // # 它与关弹窗同一类，不是「改数据」
    //
    // 点开一个折叠区只改显示。**它不提交任何东西**，与上面那段关弹窗、
    // 与用户自己在页面上点一下没有区别。
    //
    // # 只认「展开」不认「收起」，所以重复读不会来回折腾
    //
    // 展开之后控件文字会变成「收起」，不再命中 —— 而 `products.rs` 那个
    // 「读到的东西还在变多就再读一次」的重试会读好几遍。要是两个词都认，
    // 第二遍就把它又收回去了，而且看起来完全正常。
    //
    // # 「点最内层那个」按语义判，不按后代数量
    //
    // 外层容器的 innerText 也等于按钮文字，点它可能落在别的地方。**但用
    // 「后代少于 N 个」去近似「最内层」是不准的**：京麦那个展开按钮里包着
    // `<i>` + `<svg>` + `<path>` 共三个后代，用 `> 2` 一刀切正好把它挡掉，
    // 表现是「展开这件事静悄悄地什么都没做」。
    //
    // 真正的判据是：**它里面还有没有一个文字完全相同的后代**。有就说明还有
    // 更内层的，跳过；没有就是最内层的那个。图标不带文字，天然不受影响。
    var expanded = [];
    var wantExpand = a.expandText || [];
    if (wantExpand.length) {
      var cands = document.querySelectorAll('div, span, button, a, [role="button"]');
      for (var x = 0; x < cands.length && expanded.length < 8; x++) {
        var el = cands[x];
        var xt = clean(el.innerText);
        if (wantExpand.indexOf(xt) === -1) { continue; }
        if (!isRendered(el)) { continue; }
        var inner = el.querySelectorAll('*');
        var deeper = false;
        for (var y = 0; y < inner.length && !deeper; y++) {
          if (clean(inner[y].innerText) === xt) { deeper = true; }
        }
        if (deeper) { continue; }
        try { el.click(); expanded.push(xt); } catch (e) { /* 展不开就照常读 */ }
      }
    }

    // ---- 标题与类目 ----
    //
    // 标题在 `<input>` 里，要读 `value` 不是 `innerText` —— 表单控件的文本
    // 内容是空的，读错的表现是「标题永远为空」。
    var titleEl = queryTwoLevel(document, sel.editTitle)[0];
    var title = '';
    if (titleEl) {
      title = clean(titleEl.value !== undefined ? titleEl.value : titleEl.innerText);
    }
    var category = clean(textOf(document, sel.editCategory));

    // ---- 类目属性 ----
    //
    // 读的是**类目属性这个容器**，不去找具体属性 —— 类目属性本来就按类目变，
    // 这一条天然通用。值可能在三个地方：下拉的选中项（title 属性）、
    // 输入框的 value、标签。三处都收。
    var attrs = [];
    var rows = queryTwoLevel(document, sel.editAttrRow);
    for (var i = 0; i < rows.length && attrs.length < 200; i++) {
      var row = rows[i];
      var vals = [];
      queryTwoLevel(row, sel.editAttrValue).forEach(function (v) {
        var t = v.getAttribute ? (v.getAttribute('title') || '') : '';
        if (t === '') { t = clean(v.innerText); }
        t = clean(t);
        if (t !== '' && t !== '请选择' && vals.indexOf(t) === -1) { vals.push(t); }
      });
      // **三种控件都要收，不只是 input。**
      //
      // 原先只读 `input` 的 value。`<select>` 的选中项在 `options[selectedIndex].text`
      // 上、`<textarea>`（长文本属性）压根不是 input —— 两种都会整条漏掉，
      // 而漏掉的表现是那一行只剩属性名、没有值，看起来像商家没填。
      var ctrls = row.querySelectorAll('input, textarea, select');
      for (var q = 0; q < ctrls.length; q++) {
        var el = ctrls[q];
        var iv;
        if ((el.tagName || '').toUpperCase() === 'SELECT') {
          var opt = el.options && el.options[el.selectedIndex];
          iv = clean(opt ? opt.text : '');
        } else {
          iv = clean(el.value);
        }
        // 「请选择」是占位不是值。上面那一支已经挡过一次，这一支也要挡 ——
        // 有的组件把它当成真的 value 灌进 input 里。
        if (iv !== '' && iv !== '请选择' && vals.indexOf(iv) === -1) { vals.push(iv); }
      }

      // **单位要跟着数值走。**
      //
      // 后台的数值属性常把单位放在输入框外面一个 addon 里（「76」+「cm」、
      // 「500」+「g」）。只读 value 的话，「腰围：76」交给 AI，买家问「多少
      // 厘米」时它答不上来 —— 而那条属性看起来是完整的，不会有任何报错。
      //
      // **只在这一行恰好只有一个值时才拼**：多值行里单位归谁没法判，猜错
      // 就是把「50%」的单位安到「涤纶」头上。宁可不拼。
      if (vals.length === 1) {
        var addons = row.querySelectorAll('[class*="addon"], [class*="Addon"]');
        for (var ad = 0; ad < addons.length; ad++) {
          var ut = clean(addons[ad].innerText);
          // 单位都很短。长的那些是说明文字，不是单位。
          if (ut !== '' && ut.length <= 6 && vals.indexOf(ut) === -1) { vals.push(ut); }
        }
      }

      if (vals.length === 0) { continue; }
      // 属性名 = 这一行里**不是值、看得见、也不是按钮**的那部分文字。
      //
      // # 为什么不是「整行文本减去值字符串」
      //
      // 那是原先的做法，两种情形下它会错，而且都不报错：
      //
      // 1. **值是标签的子串。** 真机：`是否保密发货 否` —— 值是「否」，
      //    而标签里也有一个「否」。字符串相减把中间那个也挖掉了，属性名
      //    变成「是 保密发货」。
      // 2. **两边的文本来源不一致。** 值取的是 `innerText`（含 `<a>` 里的
      //    字），整行取的是跳过 `<a>` 的那一份。运费模板那行里有链接，
      //    于是值在整行文本里根本找不到，一个字都减不掉 —— 属性名变成了
      //    整行的前 40 字，也就是值自己的一段副本。
      //
      // # 为什么要按可见性过滤
      //
      // 京麦的下拉把**全部候选项**都渲染在行里（收起时不可见）。不过滤的
      // 结果是属性名变成
      // `腰型 自然腰 低腰 高腰 未找到合适的选项， 去提报` —— 一整串选项被
      // 当成了属性名交给 AI。真机确认过这一条。
      //
      // 判据用 `getClientRects().length`：`display:none` 与未渲染的都是 0，
      // 而**滚动到视野外的元素仍然有 rect**，所以不会误伤长表单里靠下的行。
      var name = clean(textOutside(row, queryTwoLevel(row, sel.editAttrValue)));
      // 引导语不是属性名。拼多多的属性行里跟着一句「未找到需要的品牌？
      // 点击申请」，京麦跟着「完整填写有助于商品获得更多曝光机会」。前者
      // 靠问号能一刀切干净 —— **属性名里不会有问号**，这条不挑平台也不挑
      // 品类。后者切不掉，但它被下面那个 40 字截断挡住了大半。
      var qm = name.search(/[？?]/);
      if (qm > 0) { name = name.slice(0, qm); }
      // 必填星号不是属性名的一部分，而且它是个**好用的分隔符**。
      //
      // 抖店把它渲染成独立的 `<span class="styles_required__…">*</span>`，
      // 紧贴在属性名前面。真机读出来是「* 腰型：低腰」；更糟的是面料材质
      // 那一行里还挤着一整块上传控件，整行文本是
      // 「水洗标/吊牌图 上传图片可智能识别并预填材质信息 上传图片 * 面料材质」。
      //
      // 星号**总是紧贴在属性名之前**，所以「取最后一个星号之后的部分」
      // 一刀就把前面那些说明文字切干净了。没有星号的行（京麦、拼多多）
      // 不受任何影响。
      //
      // **按字符去，不按类名**：三家的星号类名毫无共性，而「属性名里不会
      // 出现星号」在哪家都成立。
      var star = Math.max(name.lastIndexOf('*'), name.lastIndexOf('＊'));
      if (star >= 0) { name = name.slice(star + 1); }
      // v25（2026-09-05）：字数计数器不是属性名的一部分。输入框旁边那个
      // 「1/60」「46 / 60」（小红书的货号、快手的标题）是可见文本，会被当成
      // 属性名的一截 —— 「货号 1/60：1」。按形状去掉：两个数中间一道斜杠。
      name = name.replace(/\d+\s*\/\s*\d+/g, ' ');
      name = clean(name).slice(0, 40);
      var line = (name !== '' ? name + '：' : '') + vals.join(' ');
      if (attrs.indexOf(line) === -1) { attrs.push(line); }
    }

    // ---- 表格：连表头一起读 ----
    //
    // # 粘性表头会把一张表拆成两个 `<table>`
    //
    // 拼多多详情页的 SKU 表（beast-core）长这样：
    //
    //     <table class="TB_tableWrapper_…">  ← 只有 thead，tbody 空
    //     <table class="TB_tableWrapper_…">  ← 只有 tbody，没有 thead
    //
    // 逐个 `<table>` 读的结果是：第一张「有表头没数据」被下面那条规则丢掉，
    // 第二张「有数据没表头」留下来 —— 于是 SKU 那行变成
    // `165/68A | 1 | 59.00 | 69.00 | -- | 预览 | 已上架`，**列名全没了**。
    // 交给 AI 的就是七个没有名字的值，它读不出哪个是尺码哪个是库存。
    //
    // antd、element、beast-core 这一类组件库做粘性表头时都是这个形状，
    // 所以这里按**通用**规则处理：记住上一张表的表头，遇到「有数据没表头」
    // 且**列数对得上**时借用它。列数对不上就不借 —— 那多半真是另一张表，
    // 硬套会把列名安到错误的值上，而那种错误看起来完全正常。
    // # 上限：够大，而且撞到时要说出来
    //
    // 原先是「最多 4 张表、每张最多 40 行」，而且**撞到了不留任何痕迹**。
    // 40 行对一个 20 色 × 10 码的服装商家来说只有五分之一 —— 剩下的规格
    // 静静地消失，AI 拿到一份看起来完整的表，然后对着买家说「没有 XXL」。
    //
    // **一个说自己不完整的表是安全的，一个不说的才危险。** 所以两件事一起
    // 做：把上限提到覆盖真实商家（200 行 / 8 张表），并且**把真实行数一起
    // 报上去**，由 `EditTable::to_text` 在文字里写明「共 N 行，这里只列出
    // 前 M 行」。
    //
    // 为什么不干脆不限：这段文字要进多模态那一次调用，200 行已经是上万字。
    // 无上限意味着一个规格爆炸的商品能把一次学习的成本拉高一个数量级，
    // 而那不该由一次意外触发。
    var MAX_TABLES = 8;
    var MAX_ROWS = 200;
    var tables = [];
    var carriedHeads = null;
    // **只数「因为上限而没收」的那些。**
    //
    // 一开始写的是「页面上一共有几张表」，那是错的：这个选择器本来就会命中
    // 一些该丢的东西 —— 粘性表头拆出来的那半张（只有表头没有数据）在拼多多
    // 上就有一张。拿「命中数 > 收下数」当截断判据，会在**完全正常**的页面上
    // 弹出「有表没列出来」，而一个恒假的告警，用户三天就学会无视了。
    var tablesSkipped = 0;
    queryTwoLevel(document, sel.editTables).forEach(function (t) {
      if (tables.length >= MAX_TABLES) { tablesSkipped += 1; return; }
      var heads = [];
      t.querySelectorAll('thead th, thead td').forEach(function (h) {
        heads.push(clean(h.innerText));
      });
      // **行不要求在真的 `<tbody>` 里。**
      //
      // 抖店的 SKU 表用虚拟滚动，行装在
      // `<div class="ecom-g-table-tbody-virtual ecom-g-table-tbody">` 里 ——
      // 那是个 `<div>`，不是 `<tbody>`。查 `tbody tr` 一行都取不到，
      // 表现是「这件商品没有规格表」，而它明明在屏幕上。
      //
      // 改成「表里所有不在 `<thead>` 里的 `tr`」：两种结构都覆盖，
      // 而且不会把表头当数据（那正是唯一要排除的东西）。
      // 扫描的硬上限。**它与 `MAX_ROWS` 是两件事**：`MAX_ROWS` 管「收多少行
      // 进提示词」（那是钱），这一条管「最多翻多少行去数总数」（那是这一次
      // 读页面的耗时）。一张真有两千行的表，数到这里就停，说明里那个数会偏
      // 小 —— 但「至少这么多」仍然是真话。
      var SCAN_LIMIT = 2000;
      var body = [];
      var dataRows = 0;
      var trs = [];
      var allTrs = t.querySelectorAll('tr');
      for (var ti = 0; ti < allTrs.length; ti++) {
        if (allTrs[ti].closest('thead')) { continue; }
        trs.push(allTrs[ti]);
      }
      // v24（2026-09-05）：**一个数据 `tr` 都没有时，认 div 做的行。**
      //
      // antd v5 的虚拟表（快手的 SKU 表 `#skuTable`）把表头留在一张真的
      // `<table>` 里，数据行却是 `div.ant-table-row`、格子是 `div.ant-table-cell`
      // —— 整张表里没有一个数据 `tr`。按 `tr` 读的结果是「这件商品没有 SKU
      // 表」，而它明明在屏幕上；表头还会被借给下一张列数相同的表。
      //
      // 只在 `tr` 为 0 时才走这条：真 `<table>` 的 `tr` 上也带 `…-table-row`
      // 类名，两条都收会把每一行读两遍。取**最内层**的（不包着别的行），
      // 跳过测量行。
      if (trs.length === 0) {
        t.querySelectorAll('[class*="table-row"]').forEach(function (d) {
          if ((d.tagName || '').toUpperCase() === 'TR') { return; }
          if (d.closest('thead')) { return; }
          if (/measure/i.test(String(d.className || ''))) { return; }
          if (d.querySelector('[class*="table-row"]')) { return; }
          trs.push(d);
        });
      }
      // 一行里的格子：`tr` 就是 `td`；div 行取直接子级里带 `table-cell` 类名的
      // （antd 虚拟行的格子就是直接子级），没有再退到最内层的后代。
      function cellsOf(row) {
        if ((row.tagName || '').toUpperCase() === 'TR') {
          return Array.prototype.slice.call(row.querySelectorAll('td'));
        }
        var direct = [];
        for (var ci = 0; ci < row.children.length; ci++) {
          if (/table-cell/i.test(String(row.children[ci].className || ''))) { direct.push(row.children[ci]); }
        }
        if (direct.length > 0) { return direct; }
        return Array.prototype.slice.call(row.querySelectorAll('[class*="table-cell"]')).filter(function (c) {
          return !c.querySelector('[class*="table-cell"]');
        });
      }
      // **数完再截。** 只数到 `MAX_ROWS` 就停的话，`totalRows` 恒等于收下的
      // 行数，那句「一共 N 行」永远说不出真话。
      for (var r = 0; r < trs.length && dataRows < SCAN_LIMIT; r++) {
        var cells = [];
        cellsOf(trs[r]).forEach(function (c) {
          // 单元格里常常是输入框（编辑页嘛），值在 value 上。
          //
          // 读不到 value 时退到文本，但**要跳过操作按钮那一支**：拼多多的
          // SKU 表里「库存增减」那格是两个按钮（增 / 减）、「操作」那格是
          // 「上移 下移」，整格 innerText 读下来就把按钮文字当成了规格值，
          // 一路存进知识库（2026-09-01 真机探针看到的就是这两格）。
          //
          // 退到文本时走 `textOutside`（而不是 `textSkippingActions`）：它多
          // 挡一样东西 —— **视觉上隐藏、只给读屏软件看的说明文字**。抖店的
          // SKU 图那一格里塞着一整段
          // 「To pick up a draggable item, press the space bar…」，
          // 整格读下来会把它当成规格值存进知识库。
          //
          // v24（2026-09-05）：**一格里有几个输入框就收几个值。** 快手的尺码表
          // 把体重、身高做成范围，一格两个 input（「80」「100」，中间一个「-」）。
          // 只取第一个的话，「体重 80-100 斤」就变成了「体重 80」—— 95 斤的
          // 买家会被告知这个码不合适，而那条看起来完全正常。多个值之间用
          // 格子里本来的分隔符连（那个「-」），没有就用「/」。勾选框、单选框
          // 的 `value` 是编码不是值，跳过。
          var vals = [];
          var textCtrls = 0;
          var ctrls = c.querySelectorAll('input, textarea, select');
          for (var k = 0; k < ctrls.length; k++) {
            var ctl = ctrls[k];
            var tp = String(ctl.type || '').toLowerCase();
            if (tp === 'checkbox' || tp === 'radio' || tp === 'hidden' || tp === 'search') { continue; }
            textCtrls += 1;
            var cv;
            if ((ctl.tagName || '').toUpperCase() === 'SELECT') {
              var opt = ctl.options && ctl.options[ctl.selectedIndex];
              cv = clean(opt ? opt.text : '');
            } else {
              cv = clean(ctl.value);
            }
            if (cv !== '') { vals.push(cv); }
          }
          // 单选/勾选的标签是**候选项**不是值（快手 SKU 表「库存调整」那格是
          // 「加 / 减」两个单选按钮），读文本时跳过它们。
          var choiceLabels = [];
          c.querySelectorAll('label').forEach(function (lb) {
            if (lb.querySelector('input[type="radio"], input[type="checkbox"]')) { choiceLabels.push(lb); }
          });
          // 输入框的前缀、后缀是装饰不是值：货币符号、字数计数器、以及数字
          // 输入框旁边那对加减号 —— 它们常常是 `div` 不是 `button`（小红书把
          // 「增 / 减」放在 `d-input-prefix` 里），按类名一起跳过。
          c.querySelectorAll('[class*="input-prefix"], [class*="input-suffix"], [class*="spin-button"], [class*="stepper"]')
            .forEach(function (sb) { choiceLabels.push(sb); });
          var v;
          // v25（2026-09-05）：**格子里既有静态数字又有输入框时，静态数字才是值。**
          // 小红书 SKU 表的「当前库存」格是「999」加一个调整量的数字输入框
          // （值 0，旁边一对加减号）——只认输入框会读成「当前库存：0」，AI 拿它
          // 告诉买家没货了。静态文字**带数字**才算数（去掉字数计数器之后）：
          // 快手尺码表那种「-」加两个输入框的格子不受影响，仍走输入框。
          var stat = clean(textOutside(c, choiceLabels).replace(/\d+\s*\/\s*\d+/g, ' '));
          if (vals.length > 0 && /\d/.test(stat)) {
            v = stat;
          } else if (vals.length === 0 && textCtrls > 0) {
            // v25（2026-09-05）：**格子里有输入框、但一个都没填，就是空。**
            // 不退回读文本 —— 那时看得见的只有占位符、字数计数器（小红书的
            // 条形码格是「0/28」）、加减按钮，没有一样是值。读出来的
            // 「条形码：0/28」看起来像个条形码，而它什么都不是。
            v = '';
          } else if (vals.length === 0) {
            v = textOutside(c, choiceLabels);
          } else if (vals.length === 1) {
            v = vals[0];
          } else {
            var sep = clean(textOutside(c, choiceLabels));
            v = vals.join(sep !== '' && sep.length <= 2 ? sep : '/');
          }
          cells.push(clean(v));
        });
        // 整行都空的跳过 —— 编辑页上常有一行「添加规格」的占位。
        var any = false;
        for (var ci = 0; ci < cells.length; ci++) { if (cells[ci] !== '') { any = true; break; } }
        if (!any) { continue; }
        dataRows += 1;
        if (body.length < MAX_ROWS) { body.push(cells); }
      }
      // **没有数据行的表格一律丢掉。**
      //
      // 拼多多的编辑页上有一张只有表头（尺码 / 体重(kg) / 操作）、一行数据
      // 都没有的空模板表 —— 那是「点这里加一行」的占位。留着它会往学习素材
      // 里塞一张空表，AI 读到会以为这件商品有个什么都没填的规格表。
      // **表头本身教不了任何东西**，有行才有内容。
      //
      // 但丢掉之前先把表头记下来：它可能是下一张表（粘性表头拆出来的那半）
      // 的列名。见本段开头的说明。
      if (body.length === 0) {
        if (heads.length > 0) { carriedHeads = heads; }
        return;
      }
      if (heads.length === 0 && carriedHeads && carriedHeads.length === body[0].length) {
        heads = carriedHeads;
        carriedHeads = null;
      }
      // `totalRows` 是**这张表真实有多少数据行**，不是我们收了多少。
      // 两者不等时下游会在文字里写明 —— 见上面那段。
      // `totalRows` 数的是**真正有数据的行**，不是 `tr` 的个数 —— 表里常有
      // 空的测量行与占位行（京麦那张 4 个 `tr` 只有 2 行是数据）。数错的后果
      // 是在没截断的表上也弹出「被截断了」。
      tables.push({ headers: heads, rows: body, totalRows: dataRows });
    });

    // ---- 图 ----
    //
    // `data-src` 优先（懒加载时 `src` 是占位图），并且明确丢掉已知的占位图。
    var images = [];
    queryTwoLevel(document, sel.editImages).forEach(function (im) {
      var u = im.getAttribute('data-src') || im.getAttribute('src') || '';
      if (u === '' || u.indexOf('data:') === 0) { return; }
      if (u.indexOf('g.alicdn.com/s.gif') !== -1) { return; }
      // 要原图，不要页面为了省流量按显示尺寸要的那份缩略图（见 `stripOssResize`）。
      // 去掉参数之后同一张图的两处引用会合成一条，正好去重。
      u = stripOssResize(u);
      if (images.indexOf(u) === -1 && images.length < 30) { images.push(u); }
    });

    return {
      title: title, category: category,
      attrs: attrs, tables: tables, images: images,
      dismissed: dismissed, expanded: expanded,
      // 有几张表**因为上限**没被收下。0 = 没有截断。
      tablesSkipped: tablesSkipped,
      href: location.href
    };
  };

  // ---- 千牛：卖家中心的商品表格 -------------------------------------------
  //
  // # 与闲鱼那条路的差别
  //
  // 「在售」**写在地址里**（`SellManage/on_sale`），不用点标签、不用赌时序 ——
  // 闲鱼那边为此绕了三轮。这里只剩两件事：等表格出来，然后一页页读。
  //
  // # 为什么要等
  //
  // 第一次用的时候页面上是**登录页**，不是表格。等不到表格 ≠ 店里没商品 ——
  // 这两件事在观测上一模一样，而说错了用户会去检查一个没问题的店铺，而不是
  // 去扫码。所以这里把「没等到表格」单独报出去（`noTable`），由 Rust 说人话。

  function qnTextOf(root, tl) {
    var hit = queryTwoLevel(root, tl);
    if (hit.length === 0) { return ''; }
    var el = hit[0];
    // Next UI 的表格里，完整文字常常在 `title` 上，看得见的那份被截断过。
    var t = el.getAttribute && el.getAttribute('title');
    if (typeof t === 'string' && t.trim() !== '') { return t.trim(); }
    return (el.innerText || el.textContent || '').trim();
  }

  // 表格出来了没有。**必须是亚秒级的** —— 它是被反复调用的那个。
  ops.qianniuTableInfo = function (args) {
    var a = args || {};
    var sel = a.selectors || {};
    var rows = queryTwoLevel(document, sel.row);
    var t = qnTextOf(document, sel.totalText);
    var m = /(\d+)/.exec(t.replace(/[,，\s]/g, ''));
    var next = queryTwoLevel(document, sel.nextPage);
    return {
      rows: rows.length,
      total: m ? Number(m[1]) : null,
      hasNext: next.length > 0 && !next[0].disabled,
      href: location.href
    };
  };

  // 读**当前这一页**。不等待、不滚动、不翻页 —— 那些都放到 Rust 侧去做。
  //
  // # 为什么不在这里一次读完所有页
  //
  // 原先是的：一次调用里翻 50 页、每页之间等 1.5 秒。那等于给自己开了一个
  // 75 秒的窗口，**期间任何一次页面导航都会让整次调用作废** —— 而卖家中心
  // 会自己跳（登录完成、会话刷新），跳一次就全白干。
  //
  // 拆成一页一次之后，一次导航最多毁掉一页，重来一次就行。
  ops.qianniuReadPage = function (args) {
    var a = args || {};
    var sel = a.selectors || {};
    var onSaleText = String(a.onSaleStatusText || '');
    var items = [];
    var skippedNotOnSale = 0;

    var rows = queryTwoLevel(document, sel.row);
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var title = qnTextOf(row, sel.rowTitle);
      // 没标题的存不进去 —— 标题是知识库里认商品的主别名。
      if (title === '') { continue; }
      // 地址里已经筛过「在售」了，这一层是第二道防线。**读不到状态就放过** ——
      // 读不到多半是改版了，而据此丢掉全部商品比混进几件已下架的更糟。
      if (onSaleText !== '') {
        var st = qnTextOf(row, sel.rowStatus);
        if (st !== '' && st.indexOf(onSaleText) === -1) {
          skippedNotOnSale += 1;
          continue;
        }
      }
      var itemId = '';
      var itemHref = '';
      var links = queryTwoLevel(row, sel.rowLink);
      for (var k = 0; k < links.length && itemId === ''; k++) {
        var href = links[k].getAttribute ? (links[k].getAttribute('href') || '') : '';
        var m = /[?&](?:id|itemId)=([0-9]+)/.exec(href);
        if (m) {
          itemId = m[1];
          // **把原始地址也带上。** 天猫商品在 detail.tmall.com，而配置里那个
          // 前缀是 item.taobao.com —— 同一个账号可以既有淘宝店又有天猫店，
          // 两种商品在这张表里是混着的。
          itemHref = href;
        }
      }
      var imgs = queryTwoLevel(row, sel.rowThumb);
      items.push({
        title: tidyTitle(title),
        itemId: itemId,
        price: tidyPrice(qnTextOf(row, sel.rowPrice)),
        thumb: imgs.length ? (imgs[0].getAttribute('src') || '') : '',
        images: [],
        itemStatus: null,
        itemHref: itemHref
      });
    }
    return { items: items, skippedNotOnSale: skippedNotOnSale };
  };

  // 点「下一页」。**只点，不等** —— 等多久由 Rust 决定。
  ops.qianniuNextPage = function (args) {
    var a = args || {};
    var sel = a.selectors || {};
    var next = queryTwoLevel(document, sel.nextPage);
    if (next.length === 0 || next[0].disabled) { return { clicked: false }; }
    try {
      next[0].click();
      return { clicked: true };
    } catch (e) {
      return { clicked: false, error: String((e && e.message) || e) };
    }
  };

  // 当前打开的商品详情页上的属性与主图。
  //
  // **主图要全部** —— 尺码表几乎总是其中一张，而它是第几张说不准。取几张由
  // Rust 侧按多模态的上限裁（`llm::vision::MAX_IMAGES`），页面侧不替它决定。
  ops.readProductDetail = function (args) {
    var a = args || {};
    var sel = a.selectors || {};
    var attrs = [];
    var rows = queryTwoLevel(document, sel.detailAttrRow);
    for (var i = 0; i < rows.length && attrs.length < 60; i++) {
      var label = textOf(rows[i], sel.detailAttrLabel);
      var value = textOf(rows[i], sel.detailAttrValue);
      if (label === '' || value === '') { continue; }
      attrs.push({ label: label, value: value });
    }
    var images = [];
    var imgs = queryTwoLevel(document, sel.detailImage);
    for (var j = 0; j < imgs.length && images.length < 12; j++) {
      var src = imgs[j].getAttribute('src') || '';
      if (src !== '' && images.indexOf(src) === -1) { images.push(src); }
    }
    return { attrs: attrs, images: images, href: location.href };
  };

  // 导航到另一个地址。
  //
  // **只设 `location.href`，不用 `location.replace`**：后者不留历史记录，
  // 而用户在录入过程中按浏览器后退是很自然的动作。
  //
  // 注意这个 op 回答之后，页面就要开始卸载了 —— 桥会随之重装，在途的调用
  // 全部作废。所以调用方必须**先等导航完成再发下一条**（Rust 侧的
  // `navigate` 就是这么做的），而不能把它当成一次普通调用顺手发出去。
  ops.goto = function (args) {
    var a = args || {};
    // 明确要求重新加载：地址一样也要走一遍。捕获快速通道的模板时用它 ——
    // 页面只在加载时发那个列表请求，不重新加载就永远等不到。
    if (a.reload) {
      location.reload();
      return { reloaded: true, href: location.href };
    }
    var url = String(a.url || '');
    if (url === '') { throw new Error('没有给出要打开的地址'); }
    if (location.href === url) { return { already: true, href: location.href }; }
    location.href = url;
    return { already: false, href: url };
  };

  window.__shanhui = {
    v: V,
    handle: handle,
    register: function (name, fn) { ops[name] = fn; },
    selfCheck: selfCheck
  };

  installFetchHook();
  installXhrHook();
  // 装完立刻自检一次：如果我们刚刚就把某个面弄坏了，此刻撤退代价最小。
  selfCheck();
  post({ kind: 'ready', v: V, href: location.href });
})();
// 小红书千帆客服工作台的**客户端垫片**。
//
// # 这是什么
//
// 千帆客户端（`千帆客服工作台.exe`）装的其实就是一个网页：
// `walle.xiaohongshu.com/cstools/*`。它用 Electron 的 `WebContentsView`
// 加载，preload 里注入一个 `window.csBridge`，把「本地能力」交给前端 ——
// 剪贴板、本地数据库（nedb）、截图、进程内存、`ipcRenderer`。
//
// 同一个网址在普通浏览器里打开是**一片空白**：前端 bootstrap 头一件事就问
// `csBridge`，问不到就不往下走，连 `document.title` 都不改（2026-09-05 真机
// 确认：38 个节点、无文本、标题还是 `Eva`）。
//
// 这份垫片补上那些能力的**空实现**，让工作台在我们自己的内嵌 webview 里跑
// 起来。补齐之后登录页立刻渲染（156 个节点、「邮箱登录 / 短信登录 / 记住
// 密码」、5 个输入框）。
//
// # 为什么不去读千帆客户端
//
// 试过了，读不到：千帆是 Electron，它的 Chromium 无障碍树是空的（UIA 10 个
// 无名 Pane、MSAA 14 个），系统屏幕阅读器标志、`AccessibleObjectFromWindow`、
// `QueryService(IAccessible2)` 全都唤不醒。京麦那套「UIA raw view 读消息 +
// PostMessage 写字」在千帆上不成立。见
// `.internal/probe-2026-09-05-xiaohongshu-qianfan.md`。
//
// 而**这条路让小红书接待回到与快手同一个形状**：内嵌 webview + 一节画像 +
// `bridge.js` 读 DOM，Rust 侧的接待逻辑一行不改。
//
// # 纪律
//
// - **只补空实现，不伪造数据。** 每个方法要么什么都不做，要么返回一个形状
//   对的空值。唯一带值的是 `getDeviceId`，返回一个固定串 —— 它只被用来种
//   一个 `x-user-id` cookie，前端拿它做设备标识。
// - **不改 `navigator.userAgent`。** 客户端的 UA 里带 `eva/1.2.6`，我们不装
//   成它：那是「看起来像另一个客户端」，越过了「只补本地能力」这条线。真要
//   需要，那是 webview 的 `user_agent` 配置，不是这里偷偷改。
// - **不碰系统剪贴板。** `clipboard.readText` 返回空串、`writeText` 什么都
//   不做 —— 与整个写入通道「全程不碰剪贴板、不抢焦点」的纪律一致。
// - **形状必须对。** 2026-09-05 真机上只错了一处就整页白屏：
//   `performance.getDeviceId()` 前端是 `.then()` 用的，返回裸串会抛
//   `getDeviceId(...).then is not a function`。所以凡是前端可能 await 的，
//   一律返回 Promise。
//
// # 它只装给声明了 `client_shim` 的平台
//
// 由 `PageConfig::client_shim` 决定拼不拼进注入脚本（见 `web::host`）。
// 别的平台一个字节都看不到它 —— 「专属规则默认关、只在那个平台开」。

(function () {
  'use strict';

  // 已经有真的 csBridge（万一将来在千帆客户端里加载我们的脚本）就不动它。
  if (window.csBridge) { return; }

  healBrokenAuthCookie();
  healEmptyTokens();
  scheduleDiag();

  // **不种 `x-user-id`。**
  //
  // 客户端在 `ContentView.createSession` 里种过它，值是主进程存的真实设备
  // 标识。我们给不出那个值，只能编一个 —— 而编一个设备号种进去，没验证过
  // 有什么用，却可能被服务端当成异常设备。没把握有用、可能有害的东西不留。
  // （`csBridge.performance.getDeviceId()` 仍然返回一个固定串，那只是前端
  // 自己上报用的，不进 cookie。）

  function noop() {}
  function pnoop() { return Promise.resolve(); }

  // nedb 的替身。前端用它存草稿、快捷话术、本地配置。
  //
  // **回调与 Promise 两种用法都要支持**：前端按 `csBridge.getRemote` 是不是
  // 真值决定用哪一种，而我们的 `getRemote` 返回 null（不是 Electron remote），
  // 所以走回调那一支；两支都实现，免得前端哪个版本换了判据就白屏。
  function fakeDb() {
    return {
      insert: function (doc, cb) { if (cb) { cb(null, doc); } return Promise.resolve(doc); },
      update: function (q, u, o, cb) { if (cb) { cb(null, 0); } return Promise.resolve(0); },
      remove: function (q, o, cb) { if (cb) { cb(null, 0); } return Promise.resolve(0); },
      find: function (q, cb) { if (cb) { cb(null, []); } return Promise.resolve([]); },
      findOne: function (q, cb) { if (cb) { cb(null, null); } return Promise.resolve(null); },
      count: function (q, cb) { if (cb) { cb(null, 0); } return Promise.resolve(0); }
    };
  }

  // 客户端里主进程负责的那几个**跳转动作**。
  //
  // 这是垫片里唯一「不是空实现」的地方，而它必须不是空的：这几个 channel
  // 前端发出去不是为了通知谁，是**请求换一个页面**。客户端的做法是关掉
  // 这个店铺的标签、开另一个窗口；我们只有一个内嵌页面，对应的动作就是
  // 导航。
  //
  // 2026-09-05 真机撞到的就是这个：工作台一进来弹「登录认证已过期，请重新
  // 登录！」，商家点那个框上的「确定」—— 前端发 `logout`，而垫片是空的，
  // 于是**什么都不发生**，框一直在那儿。
  //
  // channel 名取自千帆主进程自己注册的那些（app.asar 里的 `ipcMain.on`）：
  // `logout` / `autoLogin:logout`（回登录页）、`login-success`（进工作台）、
  // `contentView:retry` / `splash:retry` / `splash:clearCache`（重来一次）。
  // **用相对路径**，域名跟着当前页面走。
  var ROUTE = {
    'logout': '/cstools/login'
  };

  // **`login-success` 不导航。** 这是 2026-09-05 晚对着真客户端读出来的：
  // 主进程收到 login-success 只是把登录那个 webContents 原地挂成一个标签
  // （`tab.addTab({ account, dashView: this.loginView })`），页面自己用
  // 前端路由走到工作台。它不重载。
  //
  // 第一版垫片在这里 `location.assign('/cstools/seller/dashboard')` —— 一次
  // 硬重载，正好砸在登录流程的后半段上：CAS 拿到 ST 票据之后还要换
  // accessToken 存进 localStorage，重载把这一段打断，之后每个请求都缺凭证，
  // 页面反复弹「缺失登录凭证」「登录认证已过期」。而同一天 21:50 在浏览器里
  // 那次登录一切正常，恰恰是因为那版垫片还没有这一跳。

  // **`autoLogin:logout` 不在上面那张表里，这是有意的。**
  //
  // 它和 `logout` 名字像，语义完全不同：客户端里 `logout` 由工作台窗口接，
  // 干的是 `tab.closeTab(bUserId)` —— 关掉这个店铺的标签、回登录窗；而
  // `autoLogin:logout` 由主进程接，只是 `global.autoLogin.remove(...)`，
  // **删掉本地那份「下次自动登录」的记录，不关任何窗口**。
  //
  // 我一开始把两个都翻译成「导航到登录页」，2026-09-05 真机的后果是：
  // 前端在一次清理自动登录时（`clear_auto_login`，它见到
  // `walle-eva-bUserId` cookie 非空就会调 `logout(bUserId)`）发了
  // `autoLogin:logout`，页面当场被送回登录页 —— 商家刚登录成功、店铺还
  // 在线，一条买家消息之后就退出了。
  //
  // 我们没有那份本地数据库，所以它就该是**什么都不做**。
  var RELOAD = ['contentView:retry', 'splash:retry', 'splash:clearCache'];

  // 这个 webview 的设备标识。只被拿去种一个 `x-user-id` cookie。
  var DEVICE_ID = 'shanhui-embedded-webview';

  // `ipcRenderer.invoke` 各 channel **返回什么形状**。
  //
  // 这是文件头「形状必须对」那条纪律最要命的地方：客户端里这些 channel 由
  // 主进程的 `ipcMain.handle` 应答，各有各的形状，而前端拿到就直接当那个
  // 形状用。一律返回 undefined 的后果 2026-09-05 真机撞到：商家扫码登录，
  // 页面报 `Cannot read properties of undefined (reading 'includes')` ——
  // `tab:getAllLogin` 在客户端里返回**已登录账号 id 的数组**
  // （`this.tabList.map(v => v.bUserId)`），前端拿它 `.includes(...)` 判断
  // 这个账号是不是已经开着了。给它 undefined，登录当场崩在这一行。
  //
  // 形状照抄主进程那几个 handle：
  //   tab:getAllLogin            → 数组（账号 id）
  //   autoLogin:getAutoOpen      → 布尔（开机自启）
  //   bridge:get-device-id       → 字符串
  //   bridge:get-update-version  → 字符串（客户端里是 global.updateVersion）
  //   globalShortcut             → 布尔（注册成功没有）
  //   get-current-win-data       → 对象
  //   db:invokeFn                → 文档或 null
  var INVOKE = {
    'tab:getAllLogin': function () { return []; },
    'autoLogin:getAutoOpen': function () { return false; },
    'autoLogin:setAutoOpen': function () { return false; },
    'bridge:get-device-id': function () { return DEVICE_ID; },
    'bridge:get-update-version': function () { return ''; },
    'globalShortcut': function () { return false; },
    'get-current-win-data': function () { return {}; },
    'invoke-current-win-function': function () { return null; },
    'db:invokeFn': function () { return null; }
  };

  // 没准备形状的 channel：返回 null 并**在控制台点名**。
  //
  // 返回 null 而不是 undefined，是因为 `if (x)` 会走「没有」那一支，多数
  // 时候是安全的；而点名那一句是为了下次真崩的时候一眼能看出缺哪个
  // channel —— 上面那个 `includes` 就是这样查出来的，当时什么线索都没有。
  function invokeResult(channel) {
    if (Object.prototype.hasOwnProperty.call(INVOKE, channel)) {
      return INVOKE[channel]();
    }
    try {
      console.warn('[闪回垫片] 没有为 ipcRenderer.invoke("' + channel +
        '") 准备返回值形状，先返回 null —— 页面若在这之后报「读不到 undefined 的属性」，缺的就是它');
    } catch (e) { /* 控制台被改过也无所谓 */ }
    return null;
  }

  // 种一个 cookie。**值里有分号或空格就点名** —— `document.cookie` 会在
  // 那里静默截断，而症状是「登录了却说没凭证」。
  function setCookie(name, value) {
    if (value === undefined || value === null || value === '') { return; }
    var v = String(value);
    if (/[;,\s]/.test(v)) {
      try {
        console.warn('[闪回垫片] cookie ' + name +
          ' 的值里有分号、逗号或空格，document.cookie 可能会截断它 —— 页面若仍提示缺凭证，就是这里');
      } catch (e) {}
    }
    try { document.cookie = name + '=' + v + '; path=/'; } catch (e2) {}
  }

  // **登录成功之后必须把凭证种成 cookie。**
  //
  // 客户端里这是主进程干的（`ContentView.setAutoLoginCookies`）：拿
  // `login-success` 带上来的 account，种 `walle-eva-bUserId` 与
  // `walle-eva-auth`（值是 `authToken + "!!" + accessToken`）。
  //
  // 而前端下一次页面加载时会**从那个 cookie 里把令牌读出来、拆成两半存进
  // localStorage**（`auth-token` / `accessToken`），后续接口用的是
  // localStorage 里那两个。所以不种 cookie 的后果不是「下次要重新登录」，
  // 是**这次就没有凭证**：2026-09-05 真机上商家扫码进了工作台，页面反复弹
  // 「缺失登录凭证，请重新登录」。
  function saveLoginCookies(payload) {
    var account = payload && payload.account ? payload.account : payload;
    if (!account || typeof account !== 'object') {
      try {
        console.warn('[闪回垫片] login-success 没带 account，凭证 cookie 没种上 —— 页面大概会提示缺失登录凭证');
      } catch (e) {}
      return;
    }
    // **要种就成套种，种不全就一个都不种。**
    //
    // 前端有一段「清理自动登录」（`clear_auto_login`）：它看到
    // `walle-eva-bUserId` 这个 cookie 非空，就调 `logout(bUserId)` 并**清掉
    // localStorage 里的令牌**。而那一段只在「客户端支持自动登录」时才跑。
    //
    // 所以种了 bUserId 却拿不出成对的 `walle-eva-auth`，等于亲手把自己
    // 送进那条清理路径：商家刚登录成功，令牌就被清了，页面开始反复弹
    // 「缺失登录凭证」和「登录认证已过期」（2026-09-05 真机，连着撞了两轮）。
    //
    // 这正是本文件纪律里那句「拿不出真值的凭据宁可不给」—— 上一版我只做
    // 对了一半：auth 那个不种了，bUserId 还照种。
    // **两个令牌都得有值才种。**
    //
    // 前端见到这个 cookie 就会 `split("!!")` 把两半写进 localStorage 的
    // `auth-token` 与 `accessToken`，后续接口用的是那两个。所以种半个的
    // 后果比不种糟得多：登录态看起来还在（能直接进工作台），而每个请求都
    // 401 —— 2026-09-05 真机上就是这样，商家没重新登录就进了商家页面，
    // 右下角却一直弹「需要登录」。
    //
    // 第一版这里的条件是「任一存在」，于是字段少一个就种出 `token!!`。
    var at = account.authToken;
    var ac = account.accessToken;
    if (at && ac) {
      setCookie('walle-eva-auth', String(at) + '!!' + String(ac));
      setCookie('walle-eva-bUserId', account.bUserId);
    } else {
      try {
        console.warn('[闪回垫片] login-success 的 account 里没有成对的 authToken/accessToken，' +
          '没种凭证 cookie —— 代价只是下次要重新登录，而种半个会让每个请求都 401');
      } catch (e) {}
    }
  }

  // **诊断上报。** 页面装好几秒后，把「凭证到底在不在」这几个布尔值经
  // `window.ipc` 发给 Rust 记进日志（`web` 目标下「垫片诊断」那一行）。
  //
  // 2026-09-05 晚的教训：一整晚都在猜「缺失登录凭证」是哪个 cookie 的事，
  // 而前端代码里写得明明白白 —— 每个接口请求带
  // `Authorization: localStorage.getItem("accessToken")`，那句话就是这个头
  // 为空时服务端的回话。有了这几个布尔值，下一次 exe 一跑，日志直接回答
  // 「令牌存没存上」「跨域通不通」，不必再让商家一遍遍登录来试。
  //
  // **只报有无和长度，不报值。** 令牌不能进日志。
  function scheduleDiag() {
    function run() {
      var d = { kind: 'shimDiag', href: location.href };
      try {
        d.accessToken = (localStorage.getItem('accessToken') || '').length;
        d.authToken = (localStorage.getItem('auth-token') || '').length;
        d.ticket = (localStorage.getItem('ticket') || '').length;
        d.userInfo = !!localStorage.getItem('userInfo');
      } catch (e) { d.lsErr = String(e && e.message); }
      try {
        var jar = {};
        document.cookie.split(';').forEach(function (one) {
          var t = one.trim(); var eq = t.indexOf('=');
          if (eq > 0) { jar[t.slice(0, eq)] = t.slice(eq + 1).length; }
        });
        d.cookieAuth = jar['walle-eva-auth'] || 0;
        d.cookieBUserId = jar['walle-eva-bUserId'] || 0;
        d.cookieAccessToken = jar['access-token-walle.xiaohongshu.com'] || 0;
        d.cookieCount = Object.keys(jar).length;
        // 只报名字，不报值 —— 对照真客户端的基准看少了哪一个。
        d.cookieNames = Object.keys(jar).sort().join(',');
      } catch (e2) { d.cookieErr = String(e2 && e2.message); }
      // 跨域探针：这个接口在真客户端里天天调，带凭据、带自定义头，会触发
      // 预检。同源策略没放宽的话它连服务端都到不了（TypeError），放宽了
      // 就有一个 HTTP 状态码 —— 401 也是答案，说明请求到了、只是没凭证。
      var post = function () {
        try { window.ipc && window.ipc.postMessage(JSON.stringify(d)); } catch (e3) {}
      };
      d.ua = navigator.userAgent;
      try {
        // 小红书自己的接口，探的是千帆页面的登录态。
        fetch('https://eva.xiaohongshu.com/api/edith/csa/info', { // gate-allow: 平台自己的接口
          credentials: 'include',
          headers: { 'x-subsystem': 'eva' }
        }).then(function (r) {
          d.cors = r.status;
          // 服务端的回话本身就是答案（「缺失登录凭证」是它说的），带回前 200 字。
          return r.text().then(function (t) { d.corsBody = String(t).slice(0, 200); post(); }, function () { post(); });
        }, function (err) { d.cors = 'fail:' + String(err && err.message).slice(0, 60); post(); });
      } catch (e4) { d.cors = 'throw:' + String(e4 && e4.message).slice(0, 60); post(); }
    }
    try { setTimeout(run, 4000); } catch (e) {}
  }

  // 自愈：清掉 localStorage 里**空字符串**的令牌。
  //
  // 空串比没有更糟：前端有些判断只看这个 key 在不在，于是它以为还登录着、
  // 直接进工作台，而请求带着空令牌被拒 —— 然后登出、跳登录页、又以为登录
  // 着、又进工作台。2026-09-05 真机上页面就是这么来回弹的。
  //
  // 空串的来路是上一版那个写坏的凭证 cookie：前端拿 `token!!` 拆出一个空的
  // 半边，写进了 localStorage。删掉它，状态干净成「没登录」，商家登一次就好。
  function healEmptyTokens() {
    try {
      ['auth-token', 'accessToken'].forEach(function (k) {
        var v = localStorage.getItem(k);
        if (v !== null && String(v).trim() === '') { localStorage.removeItem(k); }
      });
    } catch (e) { /* 读不到就算了 */ }
  }

  // 自愈：清掉**写坏的**凭证 cookie。
  //
  // 坏值不会自己好：前端每次页面加载都会拿这个 cookie 覆盖 localStorage 里
  // 的令牌，所以一个半截的 `token!!` 会把每一次登录都毁掉，商家自己怎么重登
  // 都没用。装载时看一眼，两半有任何一半是空的就删掉它 —— 删了最多是「这次
  // 要重新登录」，留着是「永远登不上」。
  function healBrokenAuthCookie() {
    var jar = {};
    try {
      document.cookie.split(';').forEach(function (one) {
        var t = one.trim();
        var eq = t.indexOf('=');
        if (eq > 0) { jar[t.slice(0, eq)] = t.slice(eq + 1); }
      });
    } catch (e) { return; }
    function drop(name, why) {
      try {
        document.cookie = name + '=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
        console.warn('[闪回垫片] 清掉 cookie ' + name + '：' + why);
      } catch (e2) {}
    }
    var auth = jar['walle-eva-auth'];
    var authOk = false;
    if (auth !== undefined) {
      var halves = String(auth).split('!!');
      authOk = halves.length === 2 && !!halves[0] && !!halves[1];
      if (!authOk) { drop('walle-eva-auth', '有一半是空的，留着会把每次登录都毁掉'); }
    }
    // **bUserId 不能单独存在。** 前端的「清理自动登录」见到它就会登出并
    // 清掉令牌，而那一步本该由成对的 auth cookie 兜住。没有 auth 就把它
    // 也清掉 —— 代价是这次要重新登录，留着是每次登录都被清。
    if (jar['walle-eva-bUserId'] !== undefined && !authOk) {
      drop('walle-eva-bUserId', '没有配套的 walle-eva-auth，单独留着会触发前端的清理登出');
    }
  }

  // 这一次该不该真的跳。**登录态坏掉时前端会反复发 `logout`**，而每次都跳
  // 的后果是页面在工作台与登录页之间来回弹 —— 2026-09-05 真机日志里一分半
  // 钟跳了五次，商家连验证码都来不及填完。两道闸：
  //
  //   1. 目标就是当前这一页就不跳。跳转会重载页面，把商家正在填的东西冲掉。
  //   2. 三十秒内只跳一次。计时存 `sessionStorage` 而不是变量 —— 跳转会
  //      重载页面，变量每次都归零，防抖就形同不存在。
  //
  // 拦下来之后页面停在原地，闸门会判「没登录」并把 `login_hint` 说给商家；
  // 那比一个跳不停的页面有用得多。
  function shouldNavigate(target) {
    try {
      if (target === location.pathname) { return false; }
      var last = Number(sessionStorage.getItem('__shanhui_last_route') || 0);
      if (Date.now() - last < 30000) {
        try {
          console.warn('[闪回垫片] 刚跳过一次，这次不跳（防止页面在登录页与工作台之间来回弹）：' + target);
        } catch (e2) {}
        return false;
      }
      sessionStorage.setItem('__shanhui_last_route', String(Date.now()));
    } catch (e) { /* sessionStorage 用不了就照跳 */ }
    return true;
  }

  function routeFor(channel, payload) {
    // 登录成功要先种凭证再跳，顺序反了页面读不到。
    // **这一条不受防抖限制** —— 它是商家刚刚亲手完成的动作。
    if (channel === 'login-success') {
      saveLoginCookies(payload);
      // 不跳。页面自己会路由到工作台，见上面 ROUTE 旁的说明。
      try { sessionStorage.setItem('__shanhui_last_route', '0'); } catch (e) {}
      return true;
    }
    if (Object.prototype.hasOwnProperty.call(ROUTE, channel)) {
      if (shouldNavigate(ROUTE[channel])) {
        try { location.assign(ROUTE[channel]); } catch (e) {}
      }
      return true;
    }
    if (RELOAD.indexOf(channel) !== -1) {
      try { location.reload(); } catch (e) {}
      return true;
    }
    return false;
  }

  // `ipcRenderer` 的替身。除了上面那几个跳转，发出去的都掉地上、收不到任何
  // 事件。`on` 要**返回 this**（前端会链式调用）。
  var ipc = {
    send: function (channel, payload) { routeFor(String(channel), payload); },
    sendSync: function (channel, payload) { routeFor(String(channel), payload); return invokeResult(String(channel)); },
    sendToHost: function (channel, payload) { routeFor(String(channel), payload); },
    invoke: function (channel, payload) {
      routeFor(String(channel), payload);
      return Promise.resolve(invokeResult(String(channel)));
    },
    on: function () { return this; },
    once: function () { return this; },
    off: function () { return this; },
    addListener: function () { return this; },
    removeListener: function () { return this; },
    removeAllListeners: function () { return this; }
  };

  // `BrowserWindow` 的替身。前端拿它设标题、问可见性、闪任务栏。
  function fakeWindow() {
    return {
      id: 1,
      isDestroyed: function () { return false; },
      isFocused: function () { return true; },
      isVisible: function () { return true; },
      isMinimized: function () { return false; },
      setTitle: noop, getTitle: function () { return document.title; },
      show: noop, hide: noop, focus: noop, blur: noop, restore: noop,
      minimize: noop, maximize: noop, unmaximize: noop, close: noop,
      flashFrame: noop, setAlwaysOnTop: noop, setSize: noop, setPosition: noop,
      on: noop, once: noop, removeListener: noop, removeAllListeners: noop,
      webContents: { send: noop, on: noop, once: noop, executeJavaScript: pnoop, openDevTools: noop, isDestroyed: function () { return false; } }
    };
  }

  window.csBridge = {
    // `getRemote` 说的是「有没有 Electron 的 remote 模块」。返回 null =
    // 没有，前端走回调那一支。**不返回 true** —— 那会让它去调一堆我们给不
    // 出的同步 remote API。
    getRemote: function () { return null; },
    getCurrentWindow: fakeWindow,
    ipcRenderer: ipc,
    // 剪贴板：一律空。理由见文件头的纪律。
    clipboard: {
      readText: function () { return ''; },
      writeText: noop,
      readHTML: function () { return ''; },
      writeHTML: noop,
      readImage: function () { return null; },
      writeImage: noop,
      clear: noop,
      availableFormats: function () { return []; }
    },
    nativeImage: {
      createEmpty: function () { return { isEmpty: function () { return true; }, toDataURL: function () { return ''; }, toPNG: function () { return null; } }; },
      createFromDataURL: function () { return { isEmpty: function () { return true; }, toDataURL: function () { return ''; }, toPNG: function () { return null; } }; },
      createFromPath: function () { return { isEmpty: function () { return true; }, toDataURL: function () { return ''; }, toPNG: function () { return null; } }; }
    },
    // 外链：交给系统浏览器是客户端的行为；我们这里什么都不做 ——
    // **在内嵌页面里弹出一个新窗口是我们最不想要的事**。
    shell: { openExternal: pnoop, openPath: pnoop, showItemInFolder: noop, beep: noop },
    // 截图插件。商家在千帆里按快捷键截屏发给买家，我们不提供这个 ——
    // 发图走的是素材库（`web::chat::send::send_image`）。
    screenshot: { startCapture: noop, registerShortcutCapture: noop, on: noop, off: noop },
    performance: {
      // **这几个必须返回 Promise。** `getDeviceId` 返回裸串会让整页白屏
      // （2026-09-05 真机）。
      getProcessMemoryInfo: function () { return Promise.resolve({ private: 0, shared: 0, residentSet: 0 }); },
      getProcessCPUUsage: function () { return Promise.resolve({ percentCPUUsage: 0, idleWakeupsPerSecond: 0 }); },
      getWindowCount: function () { return Promise.resolve(1); },
      getDeviceId: function () { return Promise.resolve(DEVICE_ID); }
    },
    appInfo: {
      appVersion: '1.2.6',
      osVersion: 'Windows',
      platform: 'win32',
      electronVersion: '',
      nodeVersion: ''
    },
    // 能力开关。**保守地开**：只开我们确实能承受的那几个。
    // `supportFloatWin` / `supportFloatPlayVoice` 关掉 —— 那是客户端的浮窗
    // 与声音提醒，我们没有那些窗口。
    supportNewUI: true,
    supportTab: true,
    supportArkLogin: true,
    supportFloatWin: false,
    supportFloatPlayVoice: false,
    supportBackgroundHigh: false,
    sitEnvDb: { updateSitUrl: noop },
    clientDb: { registDb: fakeDb },
    openChildWindow: noop
  };
})();
