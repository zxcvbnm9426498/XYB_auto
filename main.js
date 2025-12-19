/**
 * 一键流程：
 * 1) 唤醒并上滑解锁
 * 2) 打开摩尼定位，进入目标点并开启虚拟定位
 * 3) 打开微信，执行小程序签到/签退
 * 4) 返回摩尼定位，关闭虚拟定位
 *
 * 调试：直接运行本文件。
 */

const _cfgStorage = storages.create("xyb_config");

const MN_APP_NAME = _cfgStorage.get("MN_APP_NAME", "摩尼定位");
const MN_PKG = _cfgStorage.get("MN_PKG", "top.xuante.moloc");
const MN_TARGET_NAME = _cfgStorage.get("MN_TARGET_NAME", "红星小镇");
const MN_MOCK_ID = _cfgStorage.get("MN_MOCK_ID", "top.xuante.moloc:id/mock");
const MN_DISABLE_ID = _cfgStorage.get("MN_DISABLE_ID", "top.xuante.moloc:id/mock_snap_frm");
const MINI_PROGRAM_NAME = _cfgStorage.get("MINI_PROGRAM_NAME", "校友邦");
const WECHAT_APP_NAME = _cfgStorage.get("WECHAT_APP_NAME", "微信");
const WECHAT_PKG = _cfgStorage.get("WECHAT_PKG", "com.tencent.mm");
const WAIT_APP = _cfgStorage.get("WAIT_APP_MS", 12 * 1000);
// 桌面启动器包名（用于判断当前是否在桌面，可按实际机型修改）
const HOME_PKG = _cfgStorage.get("HOME_PKG", "com.miui.home");
// 解锁密码配置
const UNLOCK_PASSWORD = _cfgStorage.get("UNLOCK_PASSWORD", "942649");
const PASSWORD_INPUT_TIMEOUT = _cfgStorage.get("PASSWORD_INPUT_TIMEOUT", 800);
const PASSWORD_DIGIT_WAIT = _cfgStorage.get("PASSWORD_DIGIT_WAIT", 100);
// 签到后等待结果时间
const SIGNIN_RESULT_WAIT = (_cfgStorage.get("SIGNIN_RESULT_WAIT_SEC", 8)) * 1000;
// 是否解锁后预清理一次后台
const ENABLE_PRE_CLEAN_AFTER_UNLOCK = _cfgStorage.get("ENABLE_PRE_CLEAN_AFTER_UNLOCK", true);
// 是否流程结束后清理后台
const ENABLE_AUTO_CLEAN_AFTER = _cfgStorage.get("ENABLE_AUTO_CLEAN_AFTER", true);

const LOG_ROOT = files.join(engines.myEngine().cwd(), "logs");
const _now = new Date();
const _dateStr = _now.getFullYear() + "-" + (_now.getMonth() + 1) + "-" + _now.getDate();
const _timeStr = (_now.getHours() < 10 ? "0" + _now.getHours() : _now.getHours()) + "_" + 
                 (_now.getMinutes() < 10 ? "0" + _now.getMinutes() : _now.getMinutes()) + "_" + 
                 (_now.getSeconds() < 10 ? "0" + _now.getSeconds() : _now.getSeconds());
const CURRENT_LOG_DIR = files.join(LOG_ROOT, _dateStr);
const CURRENT_LOG_FILE = files.join(CURRENT_LOG_DIR, _timeStr + ".log");

if (!files.exists(CURRENT_LOG_DIR)) files.ensureDir(CURRENT_LOG_DIR + "/");

function logMsg(msg, level) {
  const now = new Date();
  const t = (now.getHours() < 10 ? "0" + now.getHours() : now.getHours()) + ":" + 
            (now.getMinutes() < 10 ? "0" + now.getMinutes() : now.getMinutes()) + ":" + 
            (now.getSeconds() < 10 ? "0" + now.getSeconds() : now.getSeconds());
  const fullMsg = "[" + t + "] " + (level || "INFO") + ": " + msg;
  
  if (level === "ERROR") {
    _origConsoleError(fullMsg);
  } else if (level === "WARN") {
    _origConsoleWarn(fullMsg);
  } else {
    _origConsoleLog(fullMsg);
  }
  
  files.append(CURRENT_LOG_FILE, fullMsg + "\n");
}

const _origConsoleLog = console.log;
const _origConsoleWarn = console.warn;
const _origConsoleError = console.error;
console.log = function() {
  const args = Array.prototype.slice.call(arguments);
  const msg = args.join(" ");
  logMsg(msg, "INFO");
};
console.warn = function() {
  const args = Array.prototype.slice.call(arguments);
  const msg = args.join(" ");
  logMsg(msg, "WARN");
};
console.error = function() {
  const args = Array.prototype.slice.call(arguments);
  const msg = args.join(" ");
  logMsg(msg, "ERROR");
};

boot();

function boot() {
  try {
    if (typeof ui !== "undefined") {
      "ui";
      ui.layout(
        <vertical padding="16">
          <text text="校友邦一键流程" textSize="20sp" textColor="#333" />
          <button id="start" text="开始执行" marginTop="16" />
          <text id="status" text="就绪" textSize="14sp" textColor="#666" marginTop="12" />
        </vertical>
      );
      ui.start.on("click", function () {
        ui.status.setText("执行中…");
        threads.start(function () {
          try {
            flowMain();
            ui.post(function () { ui.status.setText("完成"); });
          } catch (e) {
            ui.post(function () { ui.status.setText("异常: " + e); });
          }
        });
      });
      return;
    }
  } catch (e) {
  }
  flowMain();
}

function flowMain() {
  try {
    console.log("等待无障碍服务…");
    auto.waitFor();
    
    console.log("=== 步骤1: 准备运行环境 ===");
    if (!device.isScreenOn()) {
      console.log("检测到屏幕熄灭，开始解锁流程…");
      wakeAndSwipe();
      if (ENABLE_PRE_CLEAN_AFTER_UNLOCK) {
        preCleanIfNeededAfterUnlock();
      }
    } else {
      console.log("检测到屏幕已亮，跳过解锁，直接返回桌面并清理后台…");
      home();
      sleep(1000);
      cleanRecentFlow();
      home();
      sleep(800);
    }
    
    console.log("=== 步骤2: 开启虚拟定位 ===");
    startMock();
    
    console.log("=== 步骤3: 执行微信签到 ===");
    runWechatFlow();
    console.log("等待签到结果，大约 " + (SIGNIN_RESULT_WAIT / 1000) + " 秒…");
    sleep(SIGNIN_RESULT_WAIT);

    console.log("=== 步骤4: 关闭虚拟定位 ===");
    stopMock();

    if (ENABLE_AUTO_CLEAN_AFTER) {
      console.log("=== 步骤5: 清理后台应用 ===");
      cleanRecentFlow();
    } else {
      console.log("已关闭结束后自动清理后台选项，跳过步骤5");
    }

    console.log("=== 所有流程执行完成 ===");
    // 发送成功推送通知
    sendBarkNotification("校友邦签到成功", "所有流程已执行完成");
  } catch (e) {
    console.error("流程执行出错: " + e);
    console.error("错误堆栈: " + e.stack);
    // 发送失败推送通知
    sendBarkNotification("校友邦签到失败", "流程执行出错: " + e.toString());
  }
}

// 简单的 URL 编码函数
function encodeUrl(str) {
  var s = str;
  s = s.replace(/ /g, "%20");
  s = s.replace(/\n/g, "%0A");
  s = s.replace(/:/g, "%3A");
  s = s.replace(/;/g, "%3B");
  s = s.replace(/=/g, "%3D");
  s = s.replace(/\?/g, "%3F");
  s = s.replace(/&/g, "%26");
  s = s.replace(/\+/g, "%2B");
  s = s.replace(/#/g, "%23");
  s = s.replace(/\(/g, "%28");
  s = s.replace(/\)/g, "%29");
  s = s.replace(/,/g, "%2C");
  return s;
}

// 发送 Bark 推送通知
function sendBarkNotification(title, body) {
  try {
    var deviceKey = "atZXUVSwCpNZc8GuBdbkmW";
    var encodedTitle = encodeUrl(title);
    var encodedBody = encodeUrl(body);
    var url = "https://api.day.app/" + deviceKey + "/" + encodedTitle + "/" + encodedBody;
    
    console.log("发送推送通知: " + title);
    var response = http.get(url);
    if (response && response.statusCode === 200) {
      console.log("推送通知发送成功");
    } else {
      console.warn("推送通知发送失败");
    }
  } catch (e) {
    console.warn("发送推送通知时出错: " + e);
  }
}

// 解锁后如当前不在桌面，则先返回桌面并清理一次后台
function preCleanIfNeededAfterUnlock() {
  try {
    var pkg = null;
    try {
      pkg = currentPackage();
    } catch (e) {
      console.warn("获取当前前台应用包名失败: " + e);
    }

    console.log("解锁后当前前台应用包名: " + pkg);

    if (!pkg || pkg === HOME_PKG) {
      console.log("当前在桌面或包名未知，跳过预清理");
      return;
    }

    console.log("检测到解锁后前台有应用(" + pkg + ")，先执行一次清理后台流程…");
    home();
    sleep(800);
    cleanRecentFlow();
    home();
    sleep(800);
  } catch (e) {
    console.warn("预清理流程出错: " + e);
  }
}

// 输入解锁密码
function passwordInput() {
  if (!UNLOCK_PASSWORD || UNLOCK_PASSWORD.length === 0) {
    console.warn("未配置解锁密码，跳过密码输入");
    return false;
  }
  
  console.log("开始输入解锁密码…");
  
  for (var i = 0; i < UNLOCK_PASSWORD.length; i++) {
    var digit = UNLOCK_PASSWORD[i].toString();
    var p = text(digit).findOne().bounds();
    if (p) {
      click(p.centerX(), p.centerY());
      sleep(PASSWORD_DIGIT_WAIT);
    } else {
      console.error("未找到数字: " + digit);
      return false;
    }
  }
  
  console.log("密码输入完成");
  return true;
}

// 唤醒并上滑解锁
function wakeAndSwipe() {
  console.log("执行唤醒流程…");
  device.wakeUp();
  sleep(1000);
  
  // 上滑解锁
  console.log("上滑解锁…");
  swipe(device.width / 2, device.height * 0.8, device.width / 2, device.height * 0.3, 500);
  sleep(800);
  
  // 输入密码
  const passwordSuccess = passwordInput();
  if (!passwordSuccess) {
    console.warn("密码输入可能失败，继续执行流程…");
  }
  
  sleep(500); 
}

// 打开摩尼定位，进入目标并开启虚拟定位
function startMock() {
  try {
    console.log("启动摩尼定位并开启定位…");
    launchMn();
    console.log("等待应用加载完成…");
    sleep(6000);
    
    console.log("开始查找目标地点：" + MN_TARGET_NAME);
    const target = waitForOne(
      function () {
        try {
          var result = textContains(MN_TARGET_NAME).visibleToUser(true).findOne(600);
          if (result) return result;
          result = descContains(MN_TARGET_NAME).visibleToUser(true).findOne(600);
          return result;
        } catch (e) {
          console.warn("查找目标地点时出错: " + e);
          return null;
        }
      },
      10
    );
    
    if (target) {
      console.log("找到目标地点，准备点击");
      clickNodeSmart(target);
      sleep(2000);
    } else {
      console.warn("未找到目标地点：" + MN_TARGET_NAME);
      console.log("继续执行后续流程…");
    }

    console.log("查找开启定位按钮…");
    const mockBtn = waitForOne(
      function () {
        try {
          return id(MN_MOCK_ID).findOne(500);
        } catch (e) {
          console.warn("查找开启定位按钮时出错: " + e);
          return null;
        }
      },
      8
    );
    
    if (mockBtn) {
      console.log("点击开启定位按钮");
      clickNodeSmart(mockBtn);
      sleep(1000);
    } else {
      console.warn("未找到开启定位按钮");
    }

    // 弹窗继续
    console.log("检查是否有确认弹窗…");
    const cont = waitForOne(
      function () {
        try {
          var result = textMatches(/继续|确定|确认|同意|好/).findOne(600);
          if (result) return result;
          result = descMatches(/继续|确定|确认|同意|好/).findOne(600);
          return result;
        } catch (e) {
          return null;
        }
      },
      6
    );
    
    if (cont) {
      console.log("找到确认弹窗，点击");
      clickNodeSmart(cont);
      sleep(1000);
    } else {
      console.log("未找到确认弹窗，继续执行");
    }
    
    console.log("摩尼定位设置完成");
  } catch (e) {
    console.error("startMock() 执行出错: " + e);
    console.error("错误堆栈: " + e.stack);
  }
}

// 打开微信并执行小程序签到/签退
function runWechatFlow() {
  console.log("执行微信签到流程…");
  openWeChat();
  openMiniProgram();
}

// 关闭虚拟定位
function stopMock() {
  console.log("返回摩尼定位关闭定位…");
  launchMn();
  sleep(2000);

  console.log("再次查找目标地点用于关闭定位：" + MN_TARGET_NAME);
  const target = waitForOne(
    function () {
      try {
        var result = textContains(MN_TARGET_NAME).visibleToUser(true).findOne(600);
        if (result) return result;
        result = descContains(MN_TARGET_NAME).visibleToUser(true).findOne(600);
        return result;
      } catch (e) {
        console.warn("关闭时查找目标地点出错: " + e);
        return null;
      }
    },
    10
  );

  if (target) {
    console.log("找到目标地点（作为关闭入口），先点击进入/选中");
    clickNodeSmart(target);
    sleep(1500);

    console.log("查找定位开关按钮用于关闭定位…");
    const mockBtn = waitForOne(
      function () {
        try {
          return id(MN_MOCK_ID).findOne(600);
        } catch (e) {
          return null;
        }
      },
      8
    );
    if (mockBtn) {
      console.log("找到定位开关按钮，点击关闭虚拟定位");
      clickNodeSmart(mockBtn);
    } else {
      console.warn("关闭时未找到定位开关按钮，可能需要手动检查摩尼定位状态");
    }
  } else {
    console.warn("关闭时未找到目标地点：" + MN_TARGET_NAME + "，可能需要手动检查摩尼定位状态");
  }
}

// ===== 清理后台应用 =====
function cleanRecentFlow() {
  try {
    console.log("返回桌面准备清理后台应用…");
    home();
    sleep(800);
    openRecents();
    clickCleanButton();
  } catch (e) {
    console.warn("清理后台流程出错: " + e);
  }
}

function openRecents() {
  console.log("尝试使用 recents() 打开最近任务…");
  try {
    if (typeof recents === "function") {
      recents();
      sleep(1500);
      return;
    }
  } catch (e) {
    console.warn("recents() 打开最近任务失败: " + e);
  }

  console.log("尝试通过底部上滑打开最近任务…");
  const w = device.width;
  const h = device.height;
  const startX = w / 2;
  const startY = h * 0.95;
  const endX = w / 2;
  const endY = h * 0.3;
  swipe(startX, startY, endX, endY, 400);
  sleep(1500);
}

function clickCleanButton() {
  console.log("开始查找清理按钮…");

  let btn = waitForOne(
    function () {
      try {
        return (
          textContains("清理").visibleToUser(true).findOne(500) ||
          descContains("清理").visibleToUser(true).findOne(500)
        );
      } catch (e) {
        return null;
      }
    },
    6
  );

  if (!btn) {
    console.log("方法1未找到，尝试方法2（不限制可见性）");
    btn = waitForOne(
      function () {
        try {
          return (
            textContains("清理").findOne(500) ||
            descContains("清理").findOne(500)
          );
        } catch (e) {
          return null;
        }
      },
      6
    );
  }

  if (btn) {
    console.log("找到清理按钮，使用智能点击");
    clickNodeSmart(btn);
    sleep(1500);
    return;
  }

  console.warn("未通过无障碍找到清理按钮，可以根据实际位置再补充坐标点击");

  try {
    const w = device.width;
    const h = device.height;
    const x = w * 0.9;
    const y = h * 0.85;
    console.log("尝试通过坐标点击清理按钮，坐标: (" + x + ", " + y + ")");
    press(x, y, 80);
    sleep(1500);
  } catch (e) {
    console.error("坐标点击清理按钮出错: " + e);
  }
}

function launchAppByClick(appName) {
  console.log("返回桌面…");
  home();
  sleep(500);
  
  console.log("查找应用图标: " + appName);
  var appIcon = waitForOne(
    function () {
      return (
        text(appName).findOne(500) ||
        descContains(appName).findOne(500)
      );
    },
    2
  );
  
  if (!appIcon) {
    console.log("当前页面没有找到应用，右滑一下…");
    swipe(device.width * 0.8, device.height / 2, device.width * 0.2, device.height / 2, 300);
    sleep(500);
  }
  
  appIcon = waitForOne(
    function () {
      return (
        text(appName).findOne(500) ||
        descContains(appName).findOne(500)
      );
    },
    5
  );
  
  if (appIcon) {
    console.log("找到应用图标，点击打开");
    clickNodeSmart(appIcon);
    sleep(2000);
    return true;
  } else {
    console.warn("未找到应用图标: " + appName);
    return false;
  }
}

function launchMn() {
  console.log("启动应用: " + MN_APP_NAME);
  launchAppByClick(MN_APP_NAME);
  sleep(2000);
}

function waitForOne(fn, maxTry) {
  if (!maxTry || maxTry <= 0) {
    maxTry = 10;
  }
  
  for (let i = 0; i < maxTry; i++) {
    try {
      const r = fn();
      if (r) {
        return r;
      }
    } catch (e) {
      console.warn("waitForOne 执行函数时出错 (尝试 " + (i + 1) + "/" + maxTry + "): " + e);
    }
    sleep(500);
  }
  return null;
}

function waitForPackage(packageName, timeout) {
  if (!packageName) return false;
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (currentPackage() === packageName) {
      return true;
    }
    sleep(200);
  }
  console.warn("等待应用启动超时: " + packageName);
  return false;
}

function clickNodeSmart(node) {
  if (!node) return false;
  if (node.clickable && node.clickable()) {
    node.click();
    return true;
  }
  let p = node.parent && node.parent();
  while (p) {
    if (p.clickable && p.clickable()) {
      p.click();
      return true;
    }
    p = p.parent && p.parent();
  }
  const b = node.bounds && node.bounds();
  if (b) {
    press(b.centerX(), b.centerY(), 80);
    return true;
  }
  return false;
}

function openWeChat() {
  console.log("启动微信…");
  launchAppByClick(WECHAT_APP_NAME);
  sleep(2000);
}

function openMiniProgram() {
  console.log("下滑唤出小程序面板");
  swipe(device.width / 2, device.height * 0.2, device.width / 2, device.height * 0.8, 400);
  sleep(3000); 
  
  console.log("开始查找小程序：" + MINI_PROGRAM_NAME);
  
  var nameTarget = null;
  
  nameTarget = waitForOne(
    function () {
      try {
        var nodes = textContains(MINI_PROGRAM_NAME).find();
        if (nodes && nodes.length > 0) {
          console.log("找到 " + nodes.length + " 个包含'校友邦'的节点");
          for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node.clickable && node.clickable()) {
              console.log("找到可点击的节点（方法1-节点本身）");
              return node;
            }
            var parent = node.parent();
            if (parent) {
              if (parent.clickable && parent.clickable()) {
                console.log("找到可点击的节点（方法1-父节点）");
                return parent;
              }
              var grandParent = parent.parent();
              if (grandParent && grandParent.clickable && grandParent.clickable()) {
                console.log("找到可点击的节点（方法1-祖父节点）");
                return grandParent;
              }
            }
            var bounds = node.bounds();
            if (bounds && bounds.width() > 0 && bounds.height() > 0) {
              console.log("找到有边界的节点（方法1-使用边界）");
              return node;
            }
          }
        }
        
        nodes = descContains(MINI_PROGRAM_NAME).find();
        if (nodes && nodes.length > 0) {
          console.log("通过desc找到 " + nodes.length + " 个节点");
          for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node.clickable && node.clickable()) {
              return node;
            }
            var parent = node.parent();
            if (parent && parent.clickable && parent.clickable()) {
              return parent;
            }
            var bounds = node.bounds();
            if (bounds && bounds.width() > 0 && bounds.height() > 0) {
              return node;
            }
          }
        }
      } catch (e) {
        console.warn("方法1查找出错: " + e);
      }
      return null;
    },
    10
  );
  
  if (!nameTarget) {
    console.log("方法1未找到，尝试方法2（查找所有TextView）");
    nameTarget = waitForOne(
      function () {
        try {
          var allTextViews = className("android.widget.TextView").find();
          if (allTextViews && allTextViews.length > 0) {
            console.log("找到 " + allTextViews.length + " 个TextView");
            for (var i = 0; i < allTextViews.length; i++) {
              var tv = allTextViews[i];
              var text = tv.text() || "";
              var desc = tv.desc() || "";
              
              if (text.indexOf(MINI_PROGRAM_NAME) >= 0 || desc.indexOf(MINI_PROGRAM_NAME) >= 0) {
                console.log("找到包含'校友邦'的TextView");
                var parent = tv.parent();
                if (parent && parent.clickable && parent.clickable()) {
                  return parent;
                }
                var bounds = tv.bounds();
                if (bounds && bounds.width() > 0 && bounds.height() > 0) {
                  return tv;
                }
              }
            }
          }
        } catch (e) {
          console.warn("方法2查找出错: " + e);
        }
        return null;
      },
      8
    );
  }
  
  if (!nameTarget) {
    console.log("方法2未找到，尝试方法3（模糊匹配'校友'）");
    nameTarget = waitForOne(
      function () {
        try {
          var nodes = textContains("校友").find();
          if (nodes && nodes.length > 0) {
            for (var i = 0; i < nodes.length; i++) {
              var node = nodes[i];
              var text = node.text() || node.desc() || "";
              if (text.indexOf("校友邦") >= 0) {
                var parent = node.parent();
                if (parent && parent.clickable && parent.clickable()) {
                  return parent;
                }
                var bounds = node.bounds();
                if (bounds && bounds.width() > 0 && bounds.height() > 0) {
                  return node;
                }
              }
            }
          }
        } catch (e) {
          console.warn("方法3查找出错: " + e);
        }
        return null;
      },
      6
    );
  }
  if (!nameTarget) {
    console.warn("未通过无障碍找到小程序入口：" + MINI_PROGRAM_NAME + "，改用坐标点击方式");
    var coordClicked = clickXybMiniProgramByPosition();
    if (!coordClicked) {
      console.error("坐标点击校友邦小程序失败，请检查小程序位置是否发生变化");
      return;
    }
  } else {
    console.log("通过无障碍找到小程序入口，准备点击");
    var clicked = clickNodeSmart(nameTarget);
    if (!clicked) {
      var bounds = nameTarget.bounds();
      if (bounds) {
        console.log("使用bounds中心点击");
        click(bounds.centerX(), bounds.centerY());
      }
    }
  }

  const waitMs = 6000 + Math.floor(Math.random() * 4000);
  console.log("等待小程序加载（" + (waitMs / 1000) + "秒）…");
  sleep(waitMs);
  clickPracticeGrowth();
  handleCheckinOrCheckout();
}

// 通过固定坐标点击“校友邦”小程序
function clickXybMiniProgramByPosition() {
  try {
    var w = device.width;
    var h = device.height;

    var points = [
      { x: w * 0.18, y: h * 0.40 }, // 最近使用 - 校友邦
      { x: w * 0.18, y: h * 0.62 }  // 常用 - 校友邦
    ];

    var clicked = false;
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      console.log("尝试通过坐标点击校友邦小程序，第 " + (i + 1) + " 次，坐标: (" + p.x + ", " + p.y + ")");
      press(p.x, p.y, 80);
      sleep(1500);
      clicked = true;
    }
    return clicked;
  } catch (e) {
    console.error("clickXybMiniProgramByPosition 执行出错: " + e);
    return false;
  }
}

// 点击“实习成长”入口
function clickPracticeGrowth() {
  const tv = className("android.widget.TextView").text("实习成长").findOne(800);
  if (tv) {
    const parent = tv.parent && tv.parent();
    const target = parent || tv;
    console.log("点击 实习成长");
    const b = target.bounds && target.bounds();
    if (b) {
      press(b.centerX(), b.centerY(), 80);
    } else {
      clickNodeSmart(target);
    }
    sleep(1500);
    const delay = 3000 + Math.floor(Math.random() * 2000);
    sleep(delay);
    clickByRect(101, 448, 176, 522);
    return;
  }
  console.warn("未找到“实习成长”入口");
}

// 签到 / 签退
function handleCheckinOrCheckout() {
  const signIn = waitForOne(
    function () {
      return textContains("签到").visibleToUser(true).findOne(600);
    },
    6
  );
  if (signIn) {
    console.log("点击 签到");
    clickNodeSmart(signIn);
    const centerX = device.width / 2;
    const centerY = device.height / 2;
    const delay = 3500;
    console.log("等待 " + delay + "ms 后点击屏幕中心以确认签到");
    sleep(delay);
    press(centerX, centerY, 80);
    return;
  }
  const signOut = waitForOne(
    function () {
      return textContains("签退").visibleToUser(true).findOne(600);
    },
    6
  );
  if (signOut) {
    console.log("点击 签退");
    clickNodeSmart(signOut);
  } else {
    console.warn("未找到签到或签退按钮");
  }
}

function clickByTextExactly(t) {
  var n = text(t).findOne(800);
  if (n) n.click();
}

function clickByRect(left, top, right, bottom) {
  var x = (left + right) / 2;
  var y = (top + bottom) / 2;
  press(x, y, 80);
}

