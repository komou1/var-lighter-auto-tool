// ========== 全局配置参数 ==========
const GLOBAL_CONFIG = {
    // 线程控制参数
    THREAD_CONTROL: {
        isThread1Paused: false,
        isInTimeRange: false,
        lastCheckTime: null,
        pauseReason: null,
        thread1State: {
            isSleeping: false,
            currentPosition: null, // 'long' | 'short' | null
            sleepStartTime: null,
            originalPosition: null, // 记录休眠前的位置，用于恢复
            hasClosedPosition: false // 是否已经执行了平仓操作
        }
    },

    // 线程1交易配置
    THREAD1_CONFIG: {
        isRunning: true,
        iteration: 0,
        currentExchange: 'AUTO',
        currentPosition: null,
        autoDetectExchange: true,
        sleepAfter: 300000,  // 单位毫秒
        waitBeforeRetry: 1000, // 1秒
        uiUpdateDelay: 500, // 0.5秒
        executionInterval: 300, // 0.3秒
        longMaxRetries: 99,
        shortMaxRetries: 99,
        maxIterations: 10000,
        enableSafetyChecks: true
    },

    // 时间区间配置（北京时间）
    TIME_RANGES: [
        [7*60+55, 8*60+5],      // 7:55-8:05 北京时间
        // [15*60+30, 15*60+32],   // 14:43-14:45 北京时间测试
        [15*60+55, 16*60+5],    // 15:55-16:05 北京时间
        [23*60+55, 24*60+5]     // 23:55-00:05 北京时间（跨天）
    ],

    // 线程2监控配置
    THREAD2_CONFIG: {
        uiUpdateDelay: 500, // 0.5秒
        waitBeforeRetry: 1000, // 1秒
        maxRetries: 5,
        checkInterval: 300 // 30秒检查一次
    },

    // 交易所配置
    EXCHANGE_CONFIG: {
        VAR: {
            name: 'VAR交易所',
            strategy: 'LONG_FIRST',
            submitButtonSelector: 'button[data-testid="submit-button"]',
            longButtonText: '买',
            shortButtonText: '卖',
            buttonClass: '',
            longSubmitClass: '',
            shortSubmitClass: '',
            submitButtonText: ''
        },
        LIGHTER: {
            name: 'LIGHTER交易所',
            strategy: 'SHORT_FIRST',
            submitButtonSelector: '',
            longButtonText: '买入 / 做多',
            shortButtonText: '卖出 / 做空',
            buttonClass: 'text-gray-0',
            longSubmitClass: 'border-green-8',
            shortSubmitClass: 'border-red-5',
            submitButtonText: '下达市场订单'
        }
    },

    // 交易对配置
    TRADING_PAIR_CONFIG: {
        VAR: '未知交易对',
        LIGHTER: 'LIGHTER交易对'
    }
};

// ========== 共享工具函数 ==========
const SHARED_UTILS = {
    detectExchange: function() {
        const varButtons = Array.from(document.querySelectorAll('button[data-testid="submit-button"]'));
        const hasVarElements = varButtons.some(btn => 
            btn.textContent.includes('买') || btn.textContent.includes('卖')
        );
        
        if (hasVarElements) {
            console.log('📊 检测到VAR交易所');
            return 'VAR';
        }
        
        const buttons = Array.from(document.querySelectorAll('button'));
        const lighterLongBtn = buttons.find(btn => 
            btn.textContent.includes('买入 / 做多') && 
            btn.className.includes('text-gray-0')
        );
        const lighterShortBtn = buttons.find(btn => 
            btn.textContent.includes('卖出 / 做空') && 
            btn.className.includes('text-gray-0')
        );
        
        if (lighterLongBtn || lighterShortBtn) {
            console.log('📊 检测到LIGHTER交易所');
            return 'LIGHTER';
        }
        
        console.log('📊 无法自动检测交易所，使用默认VAR交易所');
        return 'VAR';
    },

    clickPositionButton: function(exchange, type) {
        const buttons = Array.from(document.querySelectorAll('button'));
        
        if (exchange === 'VAR') {
            const buttonText = type === 'long' ? '买' : '卖';
            const button = buttons.find(btn => {
                const span = btn.querySelector('span');
                return span && span.textContent.includes(buttonText) && btn.querySelector('svg');
            });
            return button;
        } else if (exchange === 'LIGHTER') {
            const buttonText = type === 'long' ? '买入 / 做多' : '卖出 / 做空';
            const button = buttons.find(btn => 
                btn.textContent.includes(buttonText) && 
                btn.className.includes('text-gray-0')
            );
            return button;
        }
        return null;
    },

    clickSubmitButton: function(exchange, type) {
        const buttons = Array.from(document.querySelectorAll('button'));
        
        if (exchange === 'VAR') {
            const submitButtons = Array.from(document.querySelectorAll('button[data-testid="submit-button"]'));
            const buttonText = type === 'long' ? '买' : '卖';
            const button = submitButtons.find(btn => 
                btn.textContent.includes(buttonText) && !btn.disabled
            );
            return button;
        } else if (exchange === 'LIGHTER') {
            const submitClass = type === 'long' ? 'border-green-8' : 'border-red-5';
            const button = buttons.find(btn => 
                btn.textContent.includes('下达市场订单') && 
                btn.className.includes(submitClass) &&
                !btn.disabled
            );
            return button;
        }
        return null;
    },

    sleep: function(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
};

// ========== 中国时间工具函数 ==========
function getChinaTime() {
    const now = new Date();
    // 中国时区 UTC+8
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const chinaTime = new Date(utc + (3600000 * 8));
    return chinaTime;
}

function formatChinaTime(date) {
    return date.toTimeString().split(' ')[0] + ' (北京时间)';
}

function getChinaTimeMinutes() {
    const chinaTime = getChinaTime();
    return chinaTime.getHours() * 60 + chinaTime.getMinutes();
}

// ========== 线程1：主逻辑 - 对冲两个交易所 ==========
let thread1Interval;

function startThread1() {
    console.log('🚀 启动线程1：交易所对冲逻辑');
    
    (function() {
        'use strict';
        
        // 使用全局配置
        const CONFIG = GLOBAL_CONFIG.THREAD1_CONFIG;
        const EXCHANGE_CONFIG = GLOBAL_CONFIG.EXCHANGE_CONFIG;
        const THREAD_CONTROL = GLOBAL_CONFIG.THREAD_CONTROL;

        // ========== 工具函数 ==========
        function sleep(ms) {
            return SHARED_UTILS.sleep(ms);
        }
        
        // 检查是否应该暂停执行
        async function checkPauseCondition() {
            while (THREAD_CONTROL.isThread1Paused) {
                const chinaTime = getChinaTime();
                const timeStr = formatChinaTime(chinaTime);
                
                if (THREAD_CONTROL.isThread1Paused) {
                    await sleep(300); // 每30秒检查一次
                }
            }
        }
        
        function detectExchange() {
            if (!CONFIG.autoDetectExchange && CONFIG.currentExchange !== 'AUTO') {
                return CONFIG.currentExchange;
            }
            
            return SHARED_UTILS.detectExchange();
        }
        
        function findButtonByConfig(exchange, type) {
            return SHARED_UTILS.clickPositionButton(exchange, type);
        }
        
        function findSubmitButton(exchange, type) {
            return SHARED_UTILS.clickSubmitButton(exchange, type);
        }
        
        function getTradingPair(exchange) {
            const config = EXCHANGE_CONFIG[exchange];
            
            if (exchange === 'VAR') {
                const submitButtons = Array.from(document.querySelectorAll(config.submitButtonSelector));
                const submitButton = submitButtons.find(btn => 
                    btn.textContent.includes(config.longButtonText) || 
                    btn.textContent.includes(config.shortButtonText)
                );
                
                if (submitButton) {
                    const text = submitButton.textContent.trim();
                    const pair = text.replace(new RegExp(`[${config.longButtonText}${config.shortButtonText}]\\s*`), '');
                    return pair || GLOBAL_CONFIG.TRADING_PAIR_CONFIG.VAR;
                }
            } else if (exchange === 'LIGHTER') {
                return GLOBAL_CONFIG.TRADING_PAIR_CONFIG.LIGHTER;
            }
            
            return '未知交易对';
        }
        
        // ========== 交易功能 ==========
        function clickPositionButton(exchange, type) {
            const button = findButtonByConfig(exchange, type);
            if (button) {
                button.click();
                console.log(`🖱️ [线程1] 已点击${type === 'long' ? '开多仓' : '开空仓'}按钮 (${EXCHANGE_CONFIG[exchange].name})`);
                return true;
            }
            return false;
        }
        
        function clickSubmitButton(exchange, type) {
            const button = findSubmitButton(exchange, type);
            if (button) {
                button.click();
                console.log(`✅ [线程1] 已点击提交按钮 (${type === 'long' ? '多' : '空'}仓)`);
                return true;
            } else {
                console.log(`❌ [线程1] 提交按钮当前不可用 (${type === 'long' ? '多' : '空'}仓)`);
                return false;
            }
        }
        
        async function openPosition(exchange, type) {
            // 检查暂停条件
            await checkPauseCondition();
            
            const maxRetries = type === 'long' ? CONFIG.longMaxRetries : CONFIG.shortMaxRetries;
            const positionName = type === 'long' ? '多' : '空';
            let retryCount = 0;
            
            while (retryCount < maxRetries) {
                // 每次重试前都检查暂停条件
                await checkPauseCondition();
                
                console.log(`🔄 [线程1] 开始执行开${positionName}仓操作... ${retryCount > 0 ? `(第${retryCount + 1}次重试)` : ''}`);
                
                if (!clickPositionButton(exchange, type)) {
                    console.log(`❌ [线程1] 未找到开${positionName}仓按钮`);
                    retryCount++;
                    if (retryCount < maxRetries) {
                        console.log(`⏳ [线程1] ${CONFIG.waitBeforeRetry/1000}秒后重试开${positionName}仓...`);
                        await sleep(CONFIG.waitBeforeRetry);
                    }
                    continue;
                }

                await sleep(CONFIG.uiUpdateDelay);
                
                if (!clickSubmitButton(exchange, type)) {
                    console.log(`❌ [线程1] 开${positionName}仓提交失败`);
                    retryCount++;
                    if (retryCount < maxRetries) {
                        console.log(`⏳ [线程1] ${CONFIG.waitBeforeRetry/1000}秒后重试开${positionName}仓...`);
                        await sleep(CONFIG.waitBeforeRetry);
                    }
                    continue;
                }
                
                console.log(`✅ [线程1] 开${positionName}仓操作完成`);
                CONFIG.currentPosition = type;
                THREAD_CONTROL.thread1State.currentPosition = type;
                return true;
            }
            
            console.log(`❌ [线程1] 开${positionName}仓操作失败，已达到最大重试次数${maxRetries}次`);
            return false;
        }
        
        // ========== 交易所策略 ==========
        async function executeVarStrategy(exchange, firstDirection) {
            // 检查暂停条件
            await checkPauseCondition();
            
            const chinaTime = getChinaTime();
            const currentTime = formatChinaTime(chinaTime);
            const tradingPair = getTradingPair(exchange);
            
            console.log(`⏰ [线程1] [${currentTime}] 第${CONFIG.iteration}次执行 - VAR策略: 先开${firstDirection === 'long' ? '多' : '空'}仓 ${tradingPair}`);
            
            const firstSuccess = await openPosition(exchange, firstDirection);
            
            if (firstSuccess) {
                console.log(`✅ [线程1] [${currentTime}] 开${firstDirection === 'long' ? '多' : '空'}仓成功`);
                
                // 记录原始仓位信息，用于恢复
                THREAD_CONTROL.thread1State.originalPosition = firstDirection;
            } else {
                console.log(`❌ [线程1] [${currentTime}] 开${firstDirection === 'long' ? '多' : '空'}仓失败，继续执行休眠流程`);
                THREAD_CONTROL.thread1State.originalPosition = null;
            }
            
            const sleepTime = firstDirection === 'long' ? CONFIG.sleepAfter : CONFIG.sleepAfter;
            console.log(`💤 [线程1] [${currentTime}] 开始休眠${sleepTime/1000}秒...`);
            
            // 标记进入休眠状态
            THREAD_CONTROL.thread1State.isSleeping = true;
            THREAD_CONTROL.thread1State.sleepStartTime = chinaTime;
            THREAD_CONTROL.thread1State.hasClosedPosition = false;
            
            // 在休眠期间也检查暂停条件
            const checkInterval = 300; // 每30秒检查一次
            let sleptTime = 0;
            while (sleptTime < sleepTime) {
                await checkPauseCondition();
                const chunk = Math.min(checkInterval, sleepTime - sleptTime);
                await sleep(chunk);
                sleptTime += chunk;
            }
            
            // 标记休眠结束
            THREAD_CONTROL.thread1State.isSleeping = false;
            THREAD_CONTROL.thread1State.sleepStartTime = null;
            
            const afterSleep = getChinaTime();
            const secondDirection = firstDirection === 'long' ? 'short' : 'long';
            console.log(`⏰ [线程1] [${formatChinaTime(afterSleep)}] 休眠结束，准备开${secondDirection === 'long' ? '多' : '空'}仓`);
            
            const secondSuccess = await openPosition(exchange, secondDirection);
            
            if (secondSuccess) {
                console.log(`✅ [线程1] [${formatChinaTime(afterSleep)}] 开${secondDirection === 'long' ? '多' : '空'}仓成功`);
            } else {
                console.log(`❌ [线程1] [${formatChinaTime(afterSleep)}] 开${secondDirection === 'long' ? '多' : '空'}仓失败，继续下一轮循环`);
            }
            
            // 重置状态
            THREAD_CONTROL.thread1State.originalPosition = null;
            THREAD_CONTROL.thread1State.hasClosedPosition = false;
        }

        async function executeLighterStrategy(exchange, firstDirection) {
            // 检查暂停条件
            await checkPauseCondition();
            
            const chinaTime = getChinaTime();
            const currentTime = formatChinaTime(chinaTime);
            const tradingPair = getTradingPair(exchange);
            
            console.log(`⏰ [线程1] [${currentTime}] 第${CONFIG.iteration}次执行 - LIGHTER策略: 先开${firstDirection === 'long' ? '多' : '空'}仓 ${tradingPair}`);
            
            const firstSuccess = await openPosition(exchange, firstDirection);
            
            if (firstSuccess) {
                console.log(`✅ [线程1] [${currentTime}] 开${firstDirection === 'long' ? '多' : '空'}仓成功`);
                
                // 记录原始仓位信息，用于恢复
                THREAD_CONTROL.thread1State.originalPosition = firstDirection;
            } else {
                console.log(`❌ [线程1] [${currentTime}] 开${firstDirection === 'long' ? '多' : '空'}仓失败，继续执行休眠流程`);
                THREAD_CONTROL.thread1State.originalPosition = null;
            }
            
            const sleepTime = firstDirection === 'long' ? CONFIG.sleepAfter : CONFIG.sleepAfter;
            console.log(`💤 [线程1] [${currentTime}] 开始休眠${sleepTime/1000}秒...`);
            
            // 标记进入休眠状态
            THREAD_CONTROL.thread1State.isSleeping = true;
            THREAD_CONTROL.thread1State.sleepStartTime = chinaTime;
            THREAD_CONTROL.thread1State.hasClosedPosition = false;
            
            // 在休眠期间也检查暂停条件
            const checkInterval = 300; // 每30秒检查一次
            let sleptTime = 0;
            while (sleptTime < sleepTime) {
                await checkPauseCondition();
                const chunk = Math.min(checkInterval, sleepTime - sleptTime);
                await sleep(chunk);
                sleptTime += chunk;
            }
            
            // 标记休眠结束
            THREAD_CONTROL.thread1State.isSleeping = false;
            THREAD_CONTROL.thread1State.sleepStartTime = null;
            
            const afterSleep = getChinaTime();
            const secondDirection = firstDirection === 'long' ? 'short' : 'long';
            console.log(`⏰ [线程1] [${formatChinaTime(afterSleep)}] 休眠结束，准备开${secondDirection === 'long' ? '多' : '空'}仓`);
            
            const secondSuccess = await openPosition(exchange, secondDirection);
            
            if (secondSuccess) {
                console.log(`✅ [线程1] [${formatChinaTime(afterSleep)}] 开${secondDirection === 'long' ? '多' : '空'}仓成功`);
            } else {
                console.log(`❌ [线程1] [${formatChinaTime(afterSleep)}] 开${secondDirection === 'long' ? '多' : '空'}仓失败，继续下一轮循环`);
            }
            
            // 重置状态
            THREAD_CONTROL.thread1State.originalPosition = null;
            THREAD_CONTROL.thread1State.hasClosedPosition = false;
        }
        
        async function executeExchangeStrategy(exchange) {
            // 检查暂停条件
            await checkPauseCondition();
            
            const strategy = EXCHANGE_CONFIG[exchange].strategy;
            
            if (strategy === 'LONG_FIRST') {
                await executeVarStrategy(exchange, 'long');
            } else if (strategy === 'SHORT_FIRST') {
                await executeLighterStrategy(exchange, 'short');
            }
        }
        
        // ========== 主循环 ==========
        async function mainLoop() {
            console.log('🎯 [线程1] 多交易所自动化交易脚本开始运行...');
            
            while (CONFIG.isRunning) {
                // 每次循环开始前检查暂停条件
                await checkPauseCondition();
                
                CONFIG.iteration++;
                
                if (CONFIG.enableSafetyChecks && CONFIG.iteration > CONFIG.maxIterations) {
                    console.error('❌ [线程1] 达到最大迭代次数，停止脚本');
                    CONFIG.isRunning = false;
                    break;
                }
                
                const exchange = detectExchange();
                const exchangeName = EXCHANGE_CONFIG[exchange].name;
                const strategy = EXCHANGE_CONFIG[exchange].strategy;
                const strategyName = strategy === 'LONG_FIRST' ? '先开多后开空' : '先开空后开多';
                
                const chinaTime = getChinaTime();
                const nextMinute = new Date(chinaTime.getTime());
                nextMinute.setMinutes(nextMinute.getMinutes() + 1);
                nextMinute.setSeconds(0);
                nextMinute.setMilliseconds(0);
                
                const waitTime = nextMinute.getTime() - chinaTime.getTime();
                
                if (waitTime > 0) {
                    console.log(`⏳ [线程1] [${formatChinaTime(chinaTime)}] 等待整点执行，剩余 ${Math.round(waitTime/1000)} 秒 (${exchangeName} - ${strategyName})`);
                    
                    // 在等待期间也检查暂停条件
                    const checkInterval = 300; // 每30秒检查一次
                    let waitedTime = 0;
                    while (waitedTime < waitTime) {
                        await checkPauseCondition();
                        const chunk = Math.min(checkInterval, waitTime - waitedTime);
                        await sleep(chunk);
                        waitedTime += chunk;
                    }
                }
                
                await executeExchangeStrategy(exchange);
            }
        }
        
        // ========== 控制接口 ==========
        mainLoop().catch(error => {
            console.error('❌ [线程1] 脚本运行出错:', error);
        });
        
        window.stopTrading = function() {
            CONFIG.isRunning = false;
            CONFIG.currentPosition = null;
            // 重置线程状态
            THREAD_CONTROL.thread1State.isSleeping = false;
            THREAD_CONTROL.thread1State.currentPosition = null;
            THREAD_CONTROL.thread1State.originalPosition = null;
            THREAD_CONTROL.thread1State.hasClosedPosition = false;
            console.log('🛑 [线程1] 交易脚本已停止');
        };
        
        window.getTradingStatus = function() {
            const exchange = detectExchange();
            const strategy = EXCHANGE_CONFIG[exchange].strategy;
            return {
                isRunning: CONFIG.isRunning,
                iteration: CONFIG.iteration,
                currentExchange: exchange,
                exchangeName: EXCHANGE_CONFIG[exchange].name,
                currentStrategy: strategy,
                strategyName: strategy === 'LONG_FIRST' ? '先开多后开空' : '先开空后开多',
                currentPosition: CONFIG.currentPosition,
                tradingPair: getTradingPair(exchange),
                config: {...CONFIG},
                exchangeConfig: {...EXCHANGE_CONFIG},
                threadControl: {...THREAD_CONTROL}
            };
        };
        
        window.switchExchange = function(exchange) {
            if (EXCHANGE_CONFIG[exchange]) {
                CONFIG.currentExchange = exchange;
                CONFIG.autoDetectExchange = false;
                const strategy = EXCHANGE_CONFIG[exchange].strategy;
                const strategyName = strategy === 'LONG_FIRST' ? '先开多后开空' : '先开空后开多';
                console.log(`🔄 [线程1] 已切换到${EXCHANGE_CONFIG[exchange].name} - ${strategyName}策略`);
            } else {
                console.log('❌ [线程1] 不支持的交易所，可用选项: VAR, LIGHTER');
            }
        };
        
        console.log('✅ [线程1] 多交易所自动化交易脚本已启动');
        console.log('📋 [线程1] 控制命令: stopTrading(), getTradingStatus(), switchExchange()');
    })();
}

// ========== 线程2：时间监控逻辑 ==========
let thread2Interval;

function startThread2() {
    console.log('🚀 启动线程2：时间监控逻辑');

    // 使用全局配置
    const THREAD2_CONFIG = GLOBAL_CONFIG.THREAD2_CONFIG;
    const TIME_RANGES = GLOBAL_CONFIG.TIME_RANGES;
    const THREAD_CONTROL = GLOBAL_CONFIG.THREAD_CONTROL;
    
    // 支持跨天时间区间的监控脚本（中国时间）
    function checkTimeRangesAdvanced() {
        const chinaTime = getChinaTime();
        const current = getChinaTimeMinutes();
        
        let inRange = false;
        let rangeInfo = '';
        
        for (const [start, end] of TIME_RANGES) {
            if (end >= 1440) {
                // 跨天情况：当前时间 >= 开始时间 或 当前时间 <= (结束时间-1440)
                if (current >= start || current <= (end - 1440)) {
                    inRange = true;
                    rangeInfo = `23:55-00:05 北京时间`;
                    break;
                }
            } else {
                // 不跨天情况
                if (current >= start && current <= end) {
                    inRange = true;
                    const startHour = Math.floor(start / 60);
                    const startMin = start % 60;
                    const endHour = Math.floor(end / 60);
                    const endMin = end % 60;
                    rangeInfo = `${startHour.toString().padStart(2, '0')}:${startMin.toString().padStart(2, '0')}-${endHour.toString().padStart(2, '0')}:${endMin.toString().padStart(2, '0')} 北京时间`;
                    break;
                }
            }
        }
        
        const timeStr = formatChinaTime(chinaTime);
        const status = inRange ? '✅ TRUE' : '❌ FALSE';
        
        // 更新全局状态
        const previousState = THREAD_CONTROL.isInTimeRange;
        THREAD_CONTROL.isInTimeRange = inRange;
        THREAD_CONTROL.lastCheckTime = chinaTime;
        THREAD_CONTROL.pauseReason = inRange ? `时间区间内 (${rangeInfo})` : null;
        
        // 控制线程1的暂停状态和平仓逻辑
        if (inRange && !THREAD_CONTROL.isThread1Paused) {
            THREAD_CONTROL.isThread1Paused = true;
            console.log(`⏸️ [线程2] [${timeStr}] 暂停线程1 - 在时间区间内: ${rangeInfo}`);
            
            // 如果线程1正在休眠且有仓位，执行平仓操作
            if (THREAD_CONTROL.thread1State.isSleeping && 
                THREAD_CONTROL.thread1State.originalPosition && 
                !THREAD_CONTROL.thread1State.hasClosedPosition) {
                
                console.log(`🔄 [线程2] [${timeStr}] 检测到线程1休眠中且有仓位，执行平仓操作`);
                closePositionAndWaitForRecovery(THREAD_CONTROL.thread1State.originalPosition);
            }
            
        } else if (!inRange && THREAD_CONTROL.isThread1Paused) {
            THREAD_CONTROL.isThread1Paused = false;
            console.log(`▶️ [线程2] [${timeStr}] 恢复线程1 - 时间区间外`);
            
            // 如果之前有平仓操作，恢复原始仓位
            if (THREAD_CONTROL.thread1State.hasClosedPosition && 
                THREAD_CONTROL.thread1State.originalPosition) {
                
                console.log(`🔄 [线程2] [${timeStr}] 恢复线程1的原始仓位`);
                recoverOriginalPosition(THREAD_CONTROL.thread1State.originalPosition);
            }
        }
        
        if (inRange !== previousState) {
            console.log(`🔄 [线程2] [${timeStr}] 状态变化: ${inRange ? '进入' : '离开'}时间区间 ${rangeInfo}`);
        }
        
        return inRange;
    }

    // 平仓操作函数
    async function closePositionAndWaitForRecovery(originalPosition) {
        const exchange = SHARED_UTILS.detectExchange();
        const oppositePosition = originalPosition === 'long' ? 'short' : 'long';
        const positionName = originalPosition === 'long' ? '多' : '空';
        const oppositeName = oppositePosition === 'long' ? '多' : '空';
        
        const chinaTime = getChinaTime();
        console.log(`📊 [线程2] [${formatChinaTime(chinaTime)}] 开始平仓操作`);
        console.log(`📋 [线程2] 详情: 开${oppositeName}仓平掉${positionName}仓, 交易所: ${exchange}`);
        
        // 调试：检查按钮状态
        console.log(`🔍 [线程2] 检查仓位按钮:`, SHARED_UTILS.clickPositionButton(exchange, oppositePosition));
        console.log(`🔍 [线程2] 检查提交按钮:`, SHARED_UTILS.clickSubmitButton(exchange, oppositePosition));
        
        try {
            // 执行平仓操作（开相反方向仓位）
            const closeSuccess = await executeClosePosition(exchange, oppositePosition);
            
            if (closeSuccess) {
                console.log(`✅ [线程2] [${formatChinaTime(chinaTime)}] 平仓操作成功完成`);
                THREAD_CONTROL.thread1State.hasClosedPosition = true;
                THREAD_CONTROL.thread1State.currentPosition = oppositePosition;
            } else {
                console.log(`❌ [线程2] [${formatChinaTime(chinaTime)}] 平仓操作失败`);
            }
        } catch (error) {
            console.error(`❌ [线程2] 平仓操作出错:`, error);
        }
    }

    // 执行平仓操作
    async function executeClosePosition(exchange, positionType) {
        const maxRetries = THREAD2_CONFIG.maxRetries;
        const positionName = positionType === 'long' ? '多' : '空';
        let retryCount = 0;
        
        // 验证当前页面状态
        const currentExchange = SHARED_UTILS.detectExchange();
        if (currentExchange !== exchange) {
            console.log(`❌ [线程2] 交易所不匹配: 预期${exchange}, 实际${currentExchange}`);
            return false;
        }
        
        while (retryCount < maxRetries) {
            const chinaTime = getChinaTime();
            console.log(`🔄 [线程2] [${formatChinaTime(chinaTime)}] 执行平仓操作: 开${positionName}仓 (第${retryCount + 1}次尝试)`);
            
            // 第一步：点击仓位按钮
            const positionButton = SHARED_UTILS.clickPositionButton(exchange, positionType);
            if (!positionButton) {
                console.log(`❌ [线程2] 未找到开${positionName}仓按钮，重试中...`);
                retryCount++;
                if (retryCount < maxRetries) {
                    await SHARED_UTILS.sleep(THREAD2_CONFIG.waitBeforeRetry);
                }
                continue;
            }
            
            console.log(`✅ [线程2] 找到开${positionName}仓按钮，正在点击...`);
            positionButton.click();
            await SHARED_UTILS.sleep(THREAD2_CONFIG.uiUpdateDelay);
            
            // 第二步：点击提交按钮
            const submitButton = SHARED_UTILS.clickSubmitButton(exchange, positionType);
            if (!submitButton) {
                console.log(`❌ [线程2] 提交按钮不可用，重试中...`);
                retryCount++;
                if (retryCount < maxRetries) {
                    await SHARED_UTILS.sleep(THREAD2_CONFIG.waitBeforeRetry);
                }
                continue;
            }
            
            console.log(`✅ [线程2] 找到提交按钮，正在提交平仓...`);
            submitButton.click();
            
            // 第三步：等待操作完成
            await SHARED_UTILS.sleep(THREAD2_CONFIG.uiUpdateDelay * 2);
            
            console.log(`✅ [线程2] 平仓操作完成`);
            return true;
        }
        
        console.log(`❌ [线程2] 平仓操作失败，已达到最大重试次数${maxRetries}次`);
        return false;
    }

    // 恢复原始仓位
    async function recoverOriginalPosition(originalPosition) {
        const exchange = SHARED_UTILS.detectExchange();
        const positionName = originalPosition === 'long' ? '多' : '空';
        const chinaTime = getChinaTime();
        
        console.log(`🔄 [线程2] [${formatChinaTime(chinaTime)}] 开始恢复原始${positionName}仓位`);
        
        try {
            const recoverSuccess = await executeClosePosition(exchange, originalPosition);
            
            if (recoverSuccess) {
                console.log(`✅ [线程2] [${formatChinaTime(chinaTime)}] 原始${positionName}仓位恢复成功`);
                THREAD_CONTROL.thread1State.hasClosedPosition = false;
                THREAD_CONTROL.thread1State.currentPosition = originalPosition;
            } else {
                console.log(`❌ [线程2] [${formatChinaTime(chinaTime)}] 原始仓位恢复失败`);
            }
        } catch (error) {
            console.error(`❌ [线程2] 恢复仓位出错:`, error);
        }
    }

    // 立即检查一次
    checkTimeRangesAdvanced();
    
    // 按配置间隔检查
    thread2Interval = setInterval(checkTimeRangesAdvanced, THREAD2_CONFIG.checkInterval);
    console.log(`✅ [线程2] 时间监控已启动，每${THREAD2_CONFIG.checkInterval/1000}秒检查一次`);
}

// ========== 多线程控制函数 ==========
function startAllThreads() {
    console.log('🎯 启动所有线程...');
    startThread1();
    startThread2();
    console.log('✅ 所有线程已启动！');
    console.log('📋 控制命令:');
    console.log('  - stopAllThreads(): 停止所有线程');
    console.log('  - stopThread1(): 停止线程1');
    console.log('  - stopThread2(): 停止线程2');
    console.log('  - restartThread1(): 重启线程1');
    console.log('  - restartThread2(): 重启线程2');
    console.log('  - getThreadStatus(): 获取线程状态');
}

function stopAllThreads() {
    console.log('🛑 停止所有线程...');
    stopThread1();
    stopThread2();
    console.log('✅ 所有线程已停止！');
}

function stopThread1() {
    if (window.stopTrading) {
        window.stopTrading();
    }
    GLOBAL_CONFIG.THREAD_CONTROL.isThread1Paused = false;
    console.log('🛑 [线程1] 已停止');
}

function stopThread2() {
    if (thread2Interval) {
        clearInterval(thread2Interval);
        thread2Interval = null;
    }
    GLOBAL_CONFIG.THREAD_CONTROL.isThread1Paused = false;
    GLOBAL_CONFIG.THREAD_CONTROL.isInTimeRange = false;
    console.log('🛑 [线程2] 已停止');
}

function restartThread1() {
    stopThread1();
    setTimeout(() => {
        console.log('🔄 重启线程1...');
        startThread1();
    }, 1000);
}

function restartThread2() {
    stopThread2();
    setTimeout(() => {
        console.log('🔄 重启线程2...');
        startThread2();
    }, 1000);
}

function getThreadStatus() {
    const chinaTime = getChinaTime();
    const timeStr = formatChinaTime(chinaTime);
    const THREAD_CONTROL = GLOBAL_CONFIG.THREAD_CONTROL;
    
    return {
        timestamp: timeStr,
        thread1: {
            status: THREAD_CONTROL.isThread1Paused ? '⏸️ 暂停中' : '▶️ 运行中',
            paused: THREAD_CONTROL.isThread1Paused,
            pauseReason: THREAD_CONTROL.pauseReason,
            isSleeping: THREAD_CONTROL.thread1State.isSleeping,
            currentPosition: THREAD_CONTROL.thread1State.currentPosition,
            originalPosition: THREAD_CONTROL.thread1State.originalPosition,
            hasClosedPosition: THREAD_CONTROL.thread1State.hasClosedPosition,
            sleepStartTime: THREAD_CONTROL.thread1State.sleepStartTime ? 
                formatChinaTime(THREAD_CONTROL.thread1State.sleepStartTime) : null
        },
        thread2: {
            status: thread2Interval ? '▶️ 运行中' : '🛑 已停止',
            inTimeRange: THREAD_CONTROL.isInTimeRange,
            lastCheck: THREAD_CONTROL.lastCheckTime ? formatChinaTime(THREAD_CONTROL.lastCheckTime) : '从未检查'
        },
        timeRanges: GLOBAL_CONFIG.TIME_RANGES.map(range => {
            const startHour = Math.floor(range[0] / 60);
            const startMin = range[0] % 60;
            const endHour = Math.floor(range[1] / 60);
            const endMin = range[1] % 60;
            return `${startHour.toString().padStart(2, '0')}:${startMin.toString().padStart(2, '0')}-${endHour.toString().padStart(2, '0')}:${endMin.toString().padStart(2, '0')} 北京时间`;
        })
    };
}

// ========== 配置管理函数 ==========
function updateConfig(newConfig) {
    Object.assign(GLOBAL_CONFIG, newConfig);
    console.log('✅ 配置已更新');
}

function getCurrentConfig() {
    return JSON.parse(JSON.stringify(GLOBAL_CONFIG));
}
// ========== 使用方法 ==========
console.log('脚本免费开源，作者推特：@ddazmon');
console.log('🎯 多线程脚本已加载！');
console.log('📋 使用方法:');
console.log('  1. 输入 startAllThreads() 启动所有线程');
console.log('  2. 输入 stopAllThreads() 停止所有线程');
console.log('  3. 可以单独控制每个线程');
console.log('  4. 输入 getCurrentConfig() 查看当前配置');
console.log('  5. 输入 updateConfig({...}) 更新配置');
console.log('');
console.log('🧵 线程1: 交易所对冲逻辑 (受线程2控制)');
console.log('🧵 线程2: 时间监控逻辑');
console.log('⏰ 监控时间区间 (北京时间):');
GLOBAL_CONFIG.TIME_RANGES.forEach(range => {
    const startHour = Math.floor(range[0] / 60);
    const startMin = range[0] % 60;
    const endHour = Math.floor(range[1] / 60);
    const endMin = range[1] % 60;
    console.log(`     ${startHour.toString().padStart(2, '0')}:${startMin.toString().padStart(2, '0')}-${endHour.toString().padStart(2, '0')}:${endMin.toString().padStart(2, '0')}`);
});
console.log('🔄 智能平仓: 线程2进入区间时，如果线程1在休眠中，会自动平仓并在区间外恢复');
console.log('📍 所有时间均使用中国时间 (UTC+8)');
startAllThreads()
