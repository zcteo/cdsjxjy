// ==UserScript==
// @name         成都市中小学继续教育网站全自动在线挂机学习&自动添加学习记录(2025-09-20更新)
// @namespace    none
// @version      2.1.1
// @description  全自动在线挂机学习&自动添加学习记录，支持最新版本
// @require      http://libs.baidu.com/jquery/1.8.3/jquery.min.js
// @author       Zed
// @match        *://www.cdsjxjy.cn/cdcte/*
// @grant        unsafeWindow
// @grant        GM_log
// @grant        GM_xmlhttpRequest
// ==/UserScript==

// ***********************************特此声明***********************************************
// 该脚本完全免费，仅供学习使用，严谨倒卖！！！ 如果您是通过购买所得，请找卖家退款！！！
// 尊重作者权益，请勿在未经允许的情况下擅自修改代码和发布到其他平台!
// 作者: Zed
// 更新时间: 2025年9月20日
// ****************************************************************************************

(function () {
    "use strict";
    const unsafeParse = (data) => {
        try {
            return JSON.parse(data);
        } catch (e) {
            return {};
        }
    };

    /**
     * 通用参数解析工具
     * 支持 query (?a=1&b=2) 和 hash (#/xxx?c=3&d=4) 的解析
     *
     * @param {string} url - 可选，默认取 window.location.href
     * @returns {Object} - 参数对象
     */
    function parseParams(url = window.location.href) {
        const result = {};

        // 拆分出 query 部分和 hash 部分
        const [base, hash] = url.split("#");
        const queryString = base.includes("?") ? base.split("?")[1] : "";
        const hashString = hash && hash.includes("?") ? hash.split("?")[1] : "";

        // 合并 query 和 hash 参数
        const searchParams = new URLSearchParams(
            queryString + "&" + (hashString || "")
        );

        for (const [key, value] of searchParams.entries()) {
            result[key] = value;
        }

        return result;
    }

    /**
     * 生成一个随机字符串
     * @param min 最小长度（默认 50）
     * @param max 最大长度（默认 100）
     * @returns 随机字符串
     */
    function randomString(min = 50, max = 100) {
        const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const length = Math.floor(Math.random() * (max - min + 1)) + min;
        let result = "";

        for (let i = 0; i < length; i++) {
            result += letters.charAt(Math.floor(Math.random() * letters.length));
        }

        return result;
    }

    /**
     * 追加参数
     * @returns
     */
    function appendParams(url, params) {
        // 拆分原始 url 和已有 query
        const [baseUrl, queryString] = url.split("?");
        const query = {};

        // 如果已有参数，先解析出来
        if (queryString) {
            queryString.split("&").forEach((part) => {
                const [key, value] = part.split("=");
                query[decodeURIComponent(key)] = decodeURIComponent(value || "");
            });
        }

        // 合并新的参数
        Object.keys(params).forEach((key) => {
            query[key] = params[key];
        });

        // 重新拼接 query
        const newQuery = Object.keys(query)
            .map(
                (key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`
            )
            .join("&");

        return newQuery ? `${baseUrl}?${newQuery}` : baseUrl;
    }

    /**
     *
     * @param {string} url
     * @param {function} success
     * @param {string} method
     * @returns
     */
    const request = (method = "POST", url, data, success, faild) => {
        const storage = unsafeParse(localStorage.getItem("cdctetorage"));
        if (typeof storage.user !== "object") {
            return;
        }
        const isGet = method === "GET";
        const config = {
            url: isGet ? appendParams(url, data) : url,
            method,
            headers: {
                "content-type": "application/json",
                Token: storage.user.token,
            },
            onload: function (response) {
                success && success(response.responseText);
            },
            onerror: function (error) {
                faild && faild(error);
            },
        };
        if (!isGet) {
            config.data = JSON.stringify(data);
        }
        GM_xmlhttpRequest(config);
    };

    const coursePage = "/prod/stu/student/course/page/selected"; // 我的课程
    const studyConfig = "/prod/stu/student/study/config/get"; // 课程学习配置
    const courseStart = "/prod/stu/student/course/study/start"; // 开始学习
    const courseHeartbeat = "/prod/stu/student/course/study/heartbeat"; // 进度记录
    const getRecord = "/prod/stu/learning/record/get"; // 获取学习记录
    const record = "/prod/stu/learning/record"; // 学习记录添加
    const targetUrls = [coursePage, studyConfig, courseStart, courseHeartbeat];
    const dataMap = {};

    /**
     * 添加学习记录
     */
    const addRecord = () => {
        const queryParams = parseParams();
        console.log(queryParams);
        request("GET", getRecord, { id: queryParams.id }, (result) => {
            const res = unsafeParse(result);
            console.log(res, "get");
            if (res.code === 200 && (res.data === null || !res.data)) {
                console.log("当前课程还未添加学习记录，正在自动添加");
                const str = randomString();
                request(
                    "POST",
                    record,
                    { courseContent: str, feeling: str, selectId: queryParams.id },
                    (r) => {
                        if (unsafeParse(r).code === 200) {
                            console.log("学习记录添加成功");
                        }
                    }
                );
            }
        });
    };

    // 确定课程
    const handleRunCoursePage = () => {
        const res = dataMap[coursePage];
        if (res.code === 200) {
            const list = res.data.content;
            const t = list.find((v) => v.duration < v.requiredTime);
            if (t) {
                unsafeWindow.ELEMENT.Message({
                    type: "success",
                    message: "已自动选中课程，2S后开始学习",
                });
                setTimeout(() => {
                    window.location.href = `/cdcte/#/coursePlay?id=${t.selectId}`;
                    window.location.reload();
                }, 2000);
            } else {
                unsafeWindow.ELEMENT.Message({
                    type: "waring",
                    message: "未查询到需要学习的课程,请先在选课中心添加",
                });
                window.location.hash = "#/onlineLearn/myLearn";
            }
        }
    };

    // 确定是否有其他课程正在学习，如果有，页面有弹窗，需要调用end接口，然后重新调用start
    const handleStart = () => {
        const res = dataMap[courseStart];
        if (res.code === 200) {
            const data = res.data;
            // 课程是否已经学习完成
            if (data.duration >= data.requiredTime) {
                console.log("已完成学习");
                unsafeWindow.ELEMENT.Message({
                    message:
                        "当前课程学习时间已完成，正在为您添加学习记录，并匹配新的学习课程，请稍等",
                    duration: 6000,
                });
                addRecord();
                setTimeout(() => {
                    request(
                        "POST",
                        coursePage,
                        { pageNum: 1, pageSize: 100 },
                        (result) => {
                            trigger(coursePage, result);
                            handleRunCoursePage();
                        }
                    );
                }, 5000);
            }
            if (data.hasOther) {
                setTimeout(() => {
                    const btn = document.querySelector(
                        ".el-message-box__btns .el-button--primary"
                    );
                    if (btn) {
                        btn.click();
                    }
                }, 0);
            }
        }
    };

    // 课程学习进度
    const handleCourseHeartbeat = () => {
        const config = dataMap[courseStart];
        const res = dataMap[courseHeartbeat];
        if (res.code === 200) {
            const data = res.data;
            console.log(data.duration, config.data.requiredTime);
            // 如果课程已经完成学习时长，重新寻找课程
            if (data.duration >= config.data.requiredTime) {
                console.log("已完成学习");
                unsafeWindow.ELEMENT.Message({
                    message:
                        "当前课程学习时间已完成，正在为您添加学习记录，并匹配新的学习课程，请稍等",
                    duration: 6000,
                });
                addRecord();
                setTimeout(() => {
                    request(
                        "POST",
                        coursePage,
                        { pageNum: 1, pageSize: 100 },
                        (result) => {
                            trigger(coursePage, result);
                            handleRunCoursePage();
                        }
                    );
                }, 5000);
            }
            // 如果需要验证
            if (data.verifyCode !== null) {
                setTimeout(() => {
                    const input = document.querySelector(
                        ".el-dialog__body .el-input__inner"
                    );
                    const btn = document.querySelector(".el-dialog__footer .submit");
                    input.value = data.verifyCode;
                    input.dispatchEvent(new Event("input", { bubbles: true }));
                    btn.click();
                }, 1000);
            }
        }
    };

    /**
     * 派发
     */
    const trigger = (url, result) => {
        dataMap[url] = unsafeParse(result);
        if (url === courseStart) {
            handleStart();
        } else if (url === courseHeartbeat) {
            handleCourseHeartbeat();
        }
    };

    const originOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (_, url) {
        if (targetUrls.some((v) => url === v)) {
            const xhr = this;
            const getter = Object.getOwnPropertyDescriptor(
                XMLHttpRequest.prototype,
                "response"
            ).get;
            Object.defineProperty(xhr, "responseText", {
                get: () => {
                    let result = getter.call(xhr);
                    trigger(url, result);
                    return result;
                },
            });
        }
        originOpen.apply(this, arguments);
    };

    const tipHashs = ["#/user/center"];
    const hashs = ["#/coursePlay"];

    let notificationInstance = null;
    const begin = () => {
        const timer = setInterval(() => {
            if (unsafeWindow.ELEMENT) {
                clearInterval(timer);
                if (tipHashs.some((v) => new RegExp(`^${v}`).test(location.hash))) {
                    unsafeWindow.ELEMENT.MessageBox.alert(
                        `
              <p>您已安装自动学习插件，以下是使用步骤</p>
              <ul>
                <li>1、进入 网上学习 ---> 选课中心 将要学习的课程“加入学习”</li>
                <li>2、进入 网上学习 ---> 我的学习 任意点击一个课程，开始学习/继续学习 </li>
                <li>3、进入学习课程的页面，插件会自动开始运行，当前课程学习完成后，插件会自动跳转下一个未完成的课程，直至“我的学习”中的课程学完</li>
              </ul>
            `,
                        "自动学习插件提示",
                        {
                            confirmButtonText: "知道了",
                            dangerouslyUseHTMLString: true,
                        }
                    );
                } else if (hashs.some((v) => new RegExp(`^${v}`).test(location.hash))) {
                    if (notificationInstance) {
                        return;
                    }
                    notificationInstance = unsafeWindow.ELEMENT.Notification({
                        title: "自动学习插件提示",
                        dangerouslyUseHTMLString: true,
                        duration: 0,
                        message: `
              <p>插件已开始自动学习，如您不想自动学习，可以在浏览器插件中手动关闭</p>
              <p style="color: red;margin-top: 10px;">插件自动运行期间，不要去干预，不要锁屏，不要切换到其他浏览器tab页，剩下的会全自动完成。如有验证码出现，插件会自己处理。即使视频没有播放也没事，进度会正常更新。此插件的方式是完全模拟人的操作，安全，省心！</p>
            `,
                    });
                } else {
                    if (notificationInstance) {
                        notificationInstance.close();
                        notificationInstance = null;
                    }
                }
            }
        }, 1000);
    };

    function triggerUrlChange() {
        window.dispatchEvent(new Event("urlchange"));
    }

    // 劫持 pushState / replaceState
    (function (history) {
        ["pushState", "replaceState"].forEach((method) => {
            const original = history[method];
            history[method] = function () {
                const result = original.apply(this, arguments);
                triggerUrlChange();
                return result;
            };
        });
    })(window.history);

    // 监听三类变化
    window.addEventListener("hashchange", triggerUrlChange);
    window.addEventListener("popstate", triggerUrlChange);
    window.addEventListener("urlchange", onUrlChange);

    function onUrlChange() {
        begin();
    }
})();
