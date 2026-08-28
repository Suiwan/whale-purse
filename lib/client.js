/**
 * whale-purse — browser half.
 *
 * 在 composer dock 里挂一块「DeepSeek 用量」读出条：账户余额（官方
 * Get User Balance）+ 当前会话的 token 用量与估算花费（按官方价格，
 * 峰谷时段自动）。点开面板看分桶明细，支持手动刷新；余额 30s、
 * 花费 3s 轮询。面板朝上弹出（composer 在页面底部）。
 *
 * 本 bundle 为手写纯 ES（无构建步骤）：React 经 require 种子词注入，
 * 样式以 <style> 注入，导出 cordis 客户端插件面（apply/inject）。
 * @module whale-purse/client
 */
window.__ModuleLoader__.load({
  id: 'whale-purse',
  factory: (require) => {
    const React = require('react')
    const { useState, useEffect, useCallback, useLayoutEffect, useRef, Fragment, useSyncExternalStore } = React
    const h = React.createElement

    const NS = 'whale-purse'

    // ---------------------------------------------------------------------
    // 字典
    // ---------------------------------------------------------------------
    const zh = {
      'whale-purse.title': 'DeepSeek 用量',
      'whale-purse.balance': '余额',
      'whale-purse.granted': '赠送',
      'whale-purse.toppedUp': '充值',
      'whale-purse.available': '可用',
      'whale-purse.unavailable': '不可用',
      'whale-purse.balanceUnavailable': '余额不可用',
      'whale-purse.sessionCost': '本会话 · 预估花费',
      'whale-purse.nonDeepSeek': '非 DeepSeek 模型，未估算花费',
      'whale-purse.bucketInput': '输入（未命中）',
      'whale-purse.bucketCacheRead': '缓存读取',
      'whale-purse.bucketCacheWrite': '缓存写入',
      'whale-purse.bucketOutput': '输出',
      'whale-purse.sumTokens': '合计 {tokens} tok',
      'whale-purse.cacheWriteFree': '缓存写入不单独计费',
      'whale-purse.peak': '高峰时段',
      'whale-purse.offPeak': '空闲时段',
      'whale-purse.nextPeak': '距高峰 {time}',
      'whale-purse.nextOffPeak': '距空闲 {time}',
      'whale-purse.staleHint': '刷新失败，显示上次快照',
      'whale-purse.lowBalance': '余额偏低 ¥{amount}',
      'whale-purse.budgetExceeded': '今日预算已超支',
      'whale-purse.standardPricing': '当前时段统一价',
      'whale-purse.updatedAt': '更新于 {time}',
      'whale-purse.officialPricing': '官方定价',
      'whale-purse.refresh': '刷新',
      'whale-purse.settings': '设置',
      'whale-purse.settingsTitle': '鲸鱼娘设置',
      'whale-purse.model': '计价模型',
      'whale-purse.lowBalanceThreshold': '低余额阈值（元）',
      'whale-purse.dailyBudget': '今日预算（元，留空不提醒）',
      'whale-purse.save': '保存',
      'whale-purse.saved': '已保存 ✓',
      'whale-purse.saving': '保存中…',
      'whale-purse.saveFailed': '保存失败，请重试',
      'whale-purse.settingsRestartHint': '设置接口不可用：请重启 DSH 后重试',
      'whale-purse.retryHint': '点击重试',
      'whale-purse.loading': '加载中…',
      'whale-purse.noData': '暂无数据',
      'whale-purse.taskDone': '「{title}」完成啦，点我看看',
      'whale-purse.tabCurrent': '当前',
      'whale-purse.tabHistory': '历史',
      'whale-purse.dailyCost': '近 7 天花费',
      'whale-purse.liveOnlyHint': '仅统计当前打开的会话',
      'whale-purse.msgCost': '本会话消息花费',
      'whale-purse.time': '时间',
      'whale-purse.cost': '花费',
      'whale-purse.question': '问题',
    }
    const en = {
      'whale-purse.title': 'DeepSeek Usage',
      'whale-purse.balance': 'Balance',
      'whale-purse.granted': 'granted',
      'whale-purse.toppedUp': 'top-up',
      'whale-purse.available': 'available',
      'whale-purse.unavailable': 'unavailable',
      'whale-purse.balanceUnavailable': 'Balance unavailable',
      'whale-purse.sessionCost': 'This session · estimated',
      'whale-purse.nonDeepSeek': 'Non-DeepSeek model, cost not estimated',
      'whale-purse.bucketInput': 'Input (cache miss)',
      'whale-purse.bucketCacheRead': 'Cache read',
      'whale-purse.bucketCacheWrite': 'Cache write',
      'whale-purse.bucketOutput': 'Output',
      'whale-purse.sumTokens': '{tokens} tok total',
      'whale-purse.cacheWriteFree': 'Cache writes are not billed separately',
      'whale-purse.peak': 'Peak hours',
      'whale-purse.offPeak': 'Off-peak hours',
      'whale-purse.nextPeak': '{time} until peak',
      'whale-purse.nextOffPeak': '{time} until off-peak',
      'whale-purse.staleHint': 'Refresh failed, showing last snapshot',
      'whale-purse.lowBalance': 'Low balance ¥{amount}',
      'whale-purse.budgetExceeded': 'Daily budget exceeded',
      'whale-purse.standardPricing': 'Flat pricing in effect',
      'whale-purse.updatedAt': 'Updated {time}',
      'whale-purse.officialPricing': 'Official pricing',
      'whale-purse.refresh': 'Refresh',
      'whale-purse.settings': 'Settings',
      'whale-purse.settingsTitle': 'Whale settings',
      'whale-purse.model': 'Pricing model',
      'whale-purse.lowBalanceThreshold': 'Low balance threshold (CNY)',
      'whale-purse.dailyBudget': 'Daily budget (CNY, blank = off)',
      'whale-purse.save': 'Save',
      'whale-purse.saved': 'Saved ✓',
      'whale-purse.saving': 'Saving…',
      'whale-purse.saveFailed': 'Save failed, try again',
      'whale-purse.settingsRestartHint': 'Settings unavailable: restart DSH and try again',
      'whale-purse.retryHint': 'Click to retry',
      'whale-purse.loading': 'Loading…',
      'whale-purse.noData': 'No data yet',
      'whale-purse.taskDone': '"{title}" is done — tap to view',
      'whale-purse.tabCurrent': 'Now',
      'whale-purse.tabHistory': 'History',
      'whale-purse.dailyCost': 'Last 7 days',
      'whale-purse.liveOnlyHint': 'Only sessions currently open',
      'whale-purse.msgCost': 'Session messages',
      'whale-purse.time': 'Time',
      'whale-purse.cost': 'Cost',
      'whale-purse.question': 'Question',
    }

    // ---------------------------------------------------------------------
    // 样式
    // ---------------------------------------------------------------------
    const CSS = `
      /* 层级修复：dsh-better-sidebar 的 Explorer 面板 fixed z-index 50~60，
         高于 shell.overlay 默认的 20，会盖住桌宠。只抬升“包含本桌宠”的
         shell.overlay（attribute 由组件挂载时打上），不再全局覆盖所有 overlay。 */
      [data-shell-overlay][data-whale-purse='active'] {
        z-index: 100 !important;
      }

      /* DSH 主题 token：--dsw-alias-* / --dsw-static-* 定义在
         design-platform.css 的 body（浅色）与 body[data-ds-dark-theme]（深色）上，
         跟随 GUI 主题自动切换。不要用 --dsh-color-*（不存在，会回退到深色底）。 */
      .wp-ball {
        position: fixed; z-index: 200;
        width: 150px; height: 230px;
        box-sizing: border-box;
        cursor: grab;
        user-select: none; touch-action: none;
        transition: transform .05s ease;
      }
      .wp-ball:active { cursor: grabbing; transform: scale(.97); }
      .wp-ball-dragging { transition: none; }

      .wp-ball-top {
        position: absolute; top: 0; left: 50%; transform: translateX(-50%);
        display: flex; align-items: center; gap: 4px;
        white-space: nowrap; pointer-events: none; z-index: 3;
      }
      .wp-ball-pill {
        display: inline-flex; align-items: center;
        padding: 4px 10px; border-radius: 999px;
        background: rgba(8, 30, 64, .38);
        border: 1px solid rgba(255, 255, 255, .22);
        color: #fff; font-size: 14px; font-weight: 700; line-height: 1;
        letter-spacing: .01em;
        font-variant-numeric: tabular-nums;
        text-shadow: 0 1px 2px rgba(0,0,0,.3);
        box-shadow: 0 2px 6px rgba(0,0,0,.2);
      }

      .wp-ball-whale {
        position: absolute; left: 50%; top: 26px;
        width: 150px; height: 200px; margin-left: -75px;
        transform-origin: 50% 92%;
        animation: wp-bob 3.4s ease-in-out infinite;
        filter: drop-shadow(0 6px 10px rgba(27,74,158,.28));
        pointer-events: none;
      }

      /* 忙碌状态：有任务在跑时鲸鱼娘加快抖动，像在干活 */
      .wp-whale-busy { animation: wp-busy 1.1s ease-in-out infinite; }
      @keyframes wp-busy {
        0%, 100% { transform: translateY(0) rotate(0deg); }
        25% { transform: translateY(-3px) rotate(-3deg); }
        50% { transform: translateY(1px) rotate(0deg); }
        75% { transform: translateY(-2px) rotate(3deg); }
      }
      .wp-ball-busy-tag {
        position: absolute; left: 50%; top: 34px; margin-left: 22px;
        padding: 2px 7px; border-radius: 999px;
        background: rgba(210, 153, 34, .85);
        color: #fff; font-size: 10px; font-weight: 600; line-height: 1.3;
        box-shadow: 0 2px 6px rgba(0,0,0,.25);
        pointer-events: none; z-index: 3;
        animation: wp-busy-tag 1.1s ease-in-out infinite;
      }
      @keyframes wp-busy-tag {
        0%, 100% { transform: translateY(0); opacity: .85; }
        50% { transform: translateY(-3px); opacity: 1; }
      }

      /* 点击回应：squash 弹跳一下 */
      .wp-whale-tap { animation: wp-tap .45s ease-out; }
      @keyframes wp-tap {
        0% { transform: translateY(0) scale(1); }
        30% { transform: translateY(-7px) scale(1.06, .94); }
        60% { transform: translateY(0) scale(.96, 1.04); }
        100% { transform: translateY(0) scale(1); }
      }

      .wp-ball-ground {
        position: absolute; left: 50%; bottom: 4px; width: 78px; height: 12px; margin-left: -39px;
        border-radius: 50%;
        background: rgba(27, 74, 158, .16);
        pointer-events: none;
      }

      .wp-ball-dot {
        width: 8px; height: 8px; border-radius: 50%;
        border: 1.5px solid rgba(255,255,255,.9);
        box-shadow: 0 1px 3px rgba(0,0,0,.3);
      }
      .wp-ball-dot-ok { background: #3ad07a; animation: wp-breathe 2.4s ease-in-out infinite; }
      .wp-ball-dot-err { background: #ff5f57; }
      .wp-ball-dot-loading { background: #ffc53d; animation: wp-breathe 1.2s ease-in-out infinite; }

      @keyframes wp-bob {
        0%, 100% { transform: translateY(0) rotate(-2deg); }
        50% { transform: translateY(-2.5px) rotate(2deg); }
      }
      @keyframes wp-breathe {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.35); opacity: .7; }
      }
      @keyframes wp-pop-val {
        0% { transform: scale(1); }
        40% { transform: scale(1.28); }
        100% { transform: scale(1); }
      }
      .wp-ball-tip {
        position: fixed; z-index: 201;
        max-width: 260px; box-sizing: border-box;
        padding: 6px 9px; border-radius: 8px;
        border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.4));
        background: var(--dsw-alias-bg-overlay, #f5f6f7);
        color: var(--dsw-alias-label-primary, #1b1b1c);
        font-size: 11px; line-height: 1.5; white-space: nowrap;
        font-variant-numeric: tabular-nums;
        box-shadow: 0 8px 24px rgba(0,0,0,.25);
        pointer-events: none;
      }

      /* 任务完成提醒气泡：浮在鲸鱼娘头顶上方，点击跳转到完成会话 */
      .wp-ball-notify {
        position: fixed; z-index: 202;
        max-width: 240px; box-sizing: border-box;
        padding: 8px 12px; border-radius: 12px;
        background: rgba(8, 30, 64, .82);
        color: #fff;
        font-size: 12.5px; font-weight: 600; line-height: 1.45;
        white-space: normal; overflow-wrap: break-word;
        box-shadow: 0 10px 28px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.15);
        cursor: pointer;
        animation: wp-notify-pop .28s ease-out;
        transition: transform .1s ease, background .1s ease;
      }
      .wp-ball-notify::after {
        content: '';
        position: absolute; bottom: -7px; left: 50%; margin-left: -6px;
        border-left: 6px solid transparent;
        border-right: 6px solid transparent;
        border-top: 7px solid rgba(70, 120, 210, .95);
      }
      .wp-ball-notify:hover { background: rgba(8, 30, 64, .92); transform: translate(-50%, calc(-100% - 2px)) scale(1.03); }
      .wp-ball-notify:active { transform: translate(-50%, calc(-100% - 2px)) scale(.97); }
      @keyframes wp-notify-pop {
        from { opacity: 0; transform: translate(-50%, calc(-100% + 10px)) scale(.9); }
        to { opacity: 1; transform: translate(-50%, -100%) scale(1); }
      }

      /* 任务完成时鲸鱼娘整体弹跳两下 */
      .wp-ball-bounce { animation: wp-bounce .7s ease-out 2; }
      @keyframes wp-bounce {
        0%, 100% { transform: translateY(0); }
        30% { transform: translateY(-16px); }
        50% { transform: translateY(0); }
        70% { transform: translateY(-8px); }
        85% { transform: translateY(0); }
      }
      .wp-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
      .wp-dot-ok { background: var(--dsw-alias-state-success-primary, #2da44e); box-shadow: 0 0 5px rgba(45,164,78,.8); }
      .wp-dot-err { background: var(--dsw-alias-state-error-primary, #e5534b); box-shadow: 0 0 5px rgba(229,83,75,.7); }
      .wp-dot-loading { background: var(--dsw-static-amber-500, #d29922); }
      .wp-bal { font-weight: 600; letter-spacing: .01em; }
      .wp-bal-missing { opacity: .55; font-weight: 600; }
      .wp-sep { opacity: .4; }
      .wp-sess { opacity: .85; }

      .wp-panel {
        position: fixed; z-index: 200;
        width: 290px; box-sizing: border-box;
        padding: 10px 12px 8px;
        border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.4));
        border-radius: 10px;
        background: var(--dsw-alias-bg-overlay, #f5f6f7);
        color: var(--dsw-alias-label-primary, #1b1b1c);
        box-shadow: 0 12px 32px rgba(0,0,0,.45), 0 2px 8px rgba(0,0,0,.3);
        font-size: 12px; line-height: 1.45;
        font-variant-numeric: tabular-nums;
        animation: wp-pop .12s ease-out;
      }
      @keyframes wp-pop { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
      .wp-panel { max-height: min(74vh, 660px); overflow-y: auto; }

      .wp-tabs { display: flex; gap: 6px; margin: 6px 0 4px; }
      .wp-tab {
        flex: 1; padding: 4px 0; border-radius: 7px;
        border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3));
        background: transparent; color: var(--dsw-alias-label-secondary, #545556);
        font-size: 11.5px; font-weight: 600; line-height: 1.2; cursor: pointer;
        transition: background .12s ease, color .12s ease;
      }
      .wp-tab:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.08)); }
      .wp-tab-active {
        background: var(--dsw-alias-button-primary-fill, #4a8fe0);
        border-color: transparent;
        color: var(--dsw-alias-label-primary-foreground, #fff);
      }

      .wp-chart { display: flex; align-items: flex-end; gap: 3px; height: 96px; padding-top: 4px; }
      .wp-chart-col {
        flex: 1; min-width: 0;
        display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 4px;
      }
      .wp-chart-val { font-size: 10px; font-weight: 600; line-height: 1; opacity: .8; white-space: nowrap; font-variant-numeric: tabular-nums; }
      .wp-chart-bar {
        width: 72%; max-width: 24px; border-radius: 3px 3px 1px 1px;
        background: linear-gradient(180deg, var(--dsw-static-deepseek-200, #d3e2ff), var(--dsw-static-deepseek-400, #679efe));
        transition: height .4s ease;
      }
      body[data-ds-dark-theme] .wp-chart-bar {
        background: linear-gradient(180deg, var(--dsw-static-deepseek-300, #b7c8fe), var(--dsw-static-deepseek-450, #5692fe));
      }
      .wp-chart-bar-zero { background: var(--dsw-alias-border-l2, rgba(128,128,128,.2)); }
      .wp-sec-label-row { display: flex; align-items: baseline; justify-content: space-between; }
      .wp-sec-sum { font-size: 10px; opacity: .65; font-variant-numeric: tabular-nums; }
      .wp-msg-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 9px; opacity: .45; padding-bottom: 2px; }
      .wp-chart-label { font-size: 9px; line-height: 1; opacity: .55; }

      .wp-msg-list { max-height: 240px; overflow-y: auto; }
      .wp-msg-row {
        display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
        padding: 4px 0;
        border-bottom: 1px dashed var(--dsw-alias-border-l2, rgba(128,128,128,.14));
        font-size: 11.5px; line-height: 1.4;
      }
      .wp-msg-row:last-child { border-bottom: none; }
      .wp-msg-q {
        flex: 1; min-width: 0; opacity: .85;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .wp-msg-head .wp-msg-q { opacity: .45; }
      .wp-msg-tokens { opacity: .55; flex: none; width: 62px; text-align: right; font-variant-numeric: tabular-nums; }
      .wp-msg-head .wp-msg-tokens { opacity: .45; }
      .wp-msg-cost { font-weight: 650; flex: none; min-width: 56px; text-align: right; font-variant-numeric: tabular-nums; }
      .wp-empty { font-size: 11px; opacity: .5; text-align: center; padding: 10px 0; }

      .wp-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
      .wp-title { font-size: 12px; font-weight: 600; letter-spacing: .02em; opacity: .92; }
      .wp-refresh {
        display: inline-flex; align-items: center; justify-content: center;
        width: 26px; height: 26px; border-radius: 7px;
        border: 1px solid transparent; background: transparent;
        color: var(--dsw-alias-label-secondary, #545556); cursor: pointer;
        font-size: 16px; line-height: 1; opacity: .75;
        transition: opacity .12s ease, border-color .12s ease, transform .3s ease;
      }
      .wp-refresh:hover { opacity: 1; border-color: var(--dsw-alias-border-l2, rgba(128,128,128,.4)); }
      .wp-refresh:active { transform: rotate(-90deg); }
      .wp-settings-btn {
        display: inline-flex; align-items: center; justify-content: center;
        width: 26px; height: 26px; border-radius: 7px;
        border: 1px solid transparent; background: transparent;
        color: var(--dsw-alias-label-secondary, #545556); cursor: pointer;
        font-size: 15px; line-height: 1; opacity: .75;
        transition: opacity .12s ease, border-color .12s ease, transform .3s ease;
      }
      .wp-settings-btn:hover { opacity: 1; border-color: var(--dsw-alias-border-l2, rgba(128,128,128,.4)); }
      .wp-settings-btn-active { opacity: 1; border-color: var(--dsw-alias-border-l2, rgba(128,128,128,.5)); background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.08)); }
      .wp-settings { padding: 8px 0 4px; border-top: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.22)); }
      .wp-field { margin-bottom: 8px; }
      .wp-field-label { display: block; font-size: 11px; opacity: .7; margin-bottom: 3px; }
      .wp-input {
        width: 100%; box-sizing: border-box;
        padding: 4px 8px; border-radius: 6px;
        border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35));
        background: var(--dsw-alias-bg-input, rgba(128,128,128,.06));
        color: var(--dsw-alias-label-primary, #1b1b1c);
        font-size: 12px; line-height: 1.3;
      }
      .wp-save {
        width: 100%; margin-top: 2px; padding: 6px 0; border-radius: 7px;
        border: 1px solid transparent;
        background: var(--dsw-alias-button-primary-fill, #4a8fe0);
        color: var(--dsw-alias-label-primary-foreground, #fff);
        font-size: 12px; font-weight: 600; cursor: pointer;
      }
      .wp-save:hover { opacity: .92; }
      .wp-save:disabled { opacity: .5; cursor: default; }


      .wp-sec { padding: 7px 0 8px; border-top: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.22)); }
      .wp-head + .wp-sec { border-top: none; }
      .wp-sec-label {
        font-size: 10px; text-transform: uppercase; letter-spacing: .08em;
        opacity: .5; margin-bottom: 4px; font-weight: 600;
      }

      .wp-bal-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
      .wp-bal-total { font-size: 22px; font-weight: 650; line-height: 1.15; letter-spacing: .01em; }
      .wp-bal-total .wp-currency { font-size: 13px; font-weight: 500; opacity: .65; margin-left: 3px; }
      .wp-bal-sub { font-size: 11px; opacity: .62; margin-top: 1px; }
      .wp-avail {
        align-self: center; flex: none;
        display: inline-flex; align-items: center; gap: 5px;
        font-size: 11px; padding: 2px 8px; border-radius: 999px;
        border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3));
      }
      .wp-avail-ok { color: var(--dsw-alias-state-success-primary, #2da44e); border-color: rgba(45,164,78,.4); }
      .wp-avail-err { color: var(--dsw-alias-state-error-primary, #e5534b); border-color: rgba(229,83,75,.4); }
      .wp-err { margin-top: 6px; font-size: 11px; color: var(--dsw-alias-state-error-primary, #e5534b); opacity: .9; overflow-wrap: anywhere; }

      .wp-cost-total { font-size: 20px; font-weight: 650; line-height: 1.15; margin-bottom: 6px; }
      .wp-cost-total .wp-currency { font-size: 12px; font-weight: 500; opacity: .65; margin-left: 3px; }

      .wp-bucket { margin-bottom: 5px; }
      .wp-bucket-line { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
      .wp-bucket-name { display: inline-flex; align-items: center; gap: 6px; opacity: .88; }
      .wp-bucket-name i { width: 7px; height: 7px; border-radius: 50%; flex: none; }
      .wp-bucket-meta { font-size: 11px; opacity: .66; }
      .wp-bar {
        display: block; height: 3px; margin-top: 3px; border-radius: 2px; overflow: hidden;
        background: var(--dsw-alias-border-l2, rgba(128,128,128,.18));
      }
      .wp-bar i { display: block; height: 100%; border-radius: 2px; transition: width .4s ease; }
      .wp-sum { margin-top: 7px; font-size: 11px; opacity: .55; }

      .wp-foot { border-top: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.22)); padding-top: 7px; margin-top: 2px; }
      .wp-price { font-size: 11px; opacity: .7; }
      .wp-price b { font-weight: 600; opacity: .95; }
      .wp-band {
        display: inline-block; margin-top: 4px; padding: 1px 7px; border-radius: 999px;
        font-size: 10px; letter-spacing: .04em;
        border: 1px solid rgba(210,153,34,.45); color: var(--dsw-static-amber-500, #d29922);
      }
      .wp-band-off { border-color: rgba(45,164,78,.4); color: var(--dsw-alias-state-success-primary, #2da44e); }
      .wp-updated { margin-top: 5px; font-size: 11px; opacity: .5; display: flex; align-items: center; justify-content: space-between; }
      .wp-updated a { color: inherit; text-decoration: underline; text-underline-offset: 2px; opacity: .9; }
      .wp-updated a:hover { opacity: 1; }
    `

    function installCss() {
      const tagId = 'whale-purse/styles.css'
      if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) === null) {
        const tag = document.createElement('style')
        tag.dataset.plugin = 'whale-purse'
        tag.dataset.pluginCss = tagId
        tag.textContent = CSS
        document.head.appendChild(tag)
      }
    }

    // ---------------------------------------------------------------------
    // 小工具
    // ---------------------------------------------------------------------
    const PRICING_PAGE_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/'
    const BALANCE_POLL_MS = 30_000
    const COST_POLL_MS = 3_000

    /**
     * 同源 JSON GET。过渡兼容：host 尚未重启时可能仍是旧的
     * `/api/balance` 路由，新路由 404 就回退一次旧路径。
     */
    async function fetchJson(path) {
      const response = await fetch(path)
      if (response.ok) return response.json()
      if (response.status === 404 && path.startsWith('/api/whale-purse/balance')) {
        const legacy = await fetch(path.replace('/api/whale-purse/balance', '/api/balance'))
        if (legacy.ok) return legacy.json()
      }
      throw new Error(`HTTP ${response.status}`)
    }

    /** 金额：≥1 保留两位；更小保留最多 4 位有效小数并去尾零（至少两位小数）。 */
    function fmtMoney(value) {
      if (!Number.isFinite(value)) return '--'
      if (value === 0) return '0.00'
      if (value >= 1) return value.toFixed(2)
      let s = value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
      const dot = s.indexOf('.')
      if (dot < 0) s += '.00'
      else if (s.length - dot - 1 < 2) s += '0'.repeat(2 - (s.length - dot - 1))
      return s
    }

    /** 余额：固定两位。 */
    function fmtBalance(value) {
      if (!Number.isFinite(value)) return '--'
      return value.toFixed(2)
    }

    function fmtTokens(n) {
      if (!Number.isFinite(n)) return '--'
      if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`
      if (n >= 1_000) return `${(n / 1_000).toFixed(2).replace(/\.?0+$/, '')}K`
      return String(n)
    }

    function fmtTime(epochMs) {
      const d = new Date(epochMs)
      const pad = (x) => String(x).padStart(2, '0')
      return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    }

    /** 倒计时短格式：`1h 23m` / `45m`。 */
    function fmtDuration(ms) {
      const total = Math.max(0, Math.floor(ms / 1000))
      const hours = Math.floor(total / 3600)
      const minutes = Math.floor((total % 3600) / 60)
      if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`
      return `${minutes}m`
    }


    /** 消息列表时间短格式：HH:MM（到分钟）。 */
    function fmtTimeMin(epochMs) {
      const d = new Date(epochMs)
      const pad = (x) => String(x).padStart(2, '0')
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`
    }

    /** 柱状图横轴日期短格式：M/D。 */
    function fmtDateShort(epochMs) {
      const d = new Date(epochMs)
      return `${d.getMonth() + 1}/${d.getDate()}`
    }

    /** 消息列表金额：≥1 两位，<1 三位小数。 */
    function fmtMoney3(value) {
      if (!Number.isFinite(value)) return '--'
      if (value >= 1) return value.toFixed(2)
      return value.toFixed(3)
    }

    /** 柱顶金额短格式：≥1 一位小数，<1 三位有效，0 空。 */
    function fmtMoneyShort(value) {
      if (!Number.isFinite(value) || value === 0) return ''
      if (value >= 1) return `¥${value.toFixed(1)}`
      return `¥${value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}`
    }

    const BUCKETS = [
      { key: 'input', tokens: 'uncachedInputTokens', labelKey: 'whale-purse.bucketInput', color: '#e3a008' },
      { key: 'cacheRead', tokens: 'cacheReadTokens', labelKey: 'whale-purse.bucketCacheRead', color: '#58a6ff' },
      { key: 'cacheWrite', tokens: 'cacheWriteTokens', labelKey: 'whale-purse.bucketCacheWrite', color: '#a78bfa' },
      { key: 'output', tokens: 'outputTokens', labelKey: 'whale-purse.bucketOutput', color: '#3fb950' },
    ]

    // ---------------------------------------------------------------------
    // 组件
    // ---------------------------------------------------------------------
    const BALL_W = 150
    const BALL_H = 230
    const BALL_MARGIN = 8
    const BALL_STORAGE_KEY = 'whale-purse:ball'

    /** 把球位置夹进视口（避免拖出屏幕）。 */
    function clampBallPos(p) {
      const vw = window.innerWidth
      const vh = window.innerHeight
      return {
        x: Math.max(BALL_MARGIN, Math.min(p.x, vw - BALL_W - BALL_MARGIN)),
        y: Math.max(BALL_MARGIN, Math.min(p.y, vh - BALL_H - BALL_MARGIN)),
      }
    }

    /** 读持久化的球位置；损坏或缺失时用默认（右下、composer 上方）。 */
    function loadBallPos() {
      try {
        const raw = window.localStorage.getItem(BALL_STORAGE_KEY)
        if (raw !== null) {
          const parsed = JSON.parse(raw)
          if (typeof parsed.x === 'number' && typeof parsed.y === 'number') return clampBallPos(parsed)
        }
      } catch { /* 位置损坏时回默认 */ }
      return {
        x: window.innerWidth - BALL_W - 28,
        y: window.innerHeight - BALL_H - 40,
      }
    }

    /** 球内余额短格式：≥1000 用 k，≥100 一位小数，其余两位。 */
    function fmtBallShort(value) {
      if (!Number.isFinite(value)) return '--'
      if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`
      if (value >= 100) return value.toFixed(1)
      return value.toFixed(2)
    }

    /** 鲸鱼娘立绘 data URI（assets/whale-sprite.webp，280×373 透明；由 scripts/embed-asset.mjs 生成） */
    const WHALE_SPRITE = 'data:image/webp;base64,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'

    /** 把底层 abort 文案换成可读提示，其余原样返回（服务端已友好化，这里兜底）。 */
    function prettyError(message) {
      if (typeof message !== 'string' || message.length === 0) return message
      if (/abort/i.test(message)) return '请求超时'
      return message
    }

    function UsageMeter(props) {
      const t = props.t
      const sessions = props.sessions
      // shell.overlay 是 root scope，没有框架注入的 sessionId；
      // 直接订阅 sessions 服务的当前会话投影（无会话时为 undefined）。
      const sessionId = useSyncExternalStore(
        (cb) => sessions?.currentProvideInfo?.subscribe(cb) ?? (() => {}),
        () => sessions?.currentProvideInfo?.getSnapshot()?.sessionId,
      )
      // 任务完成提醒：订阅会话列表，检测 running true→false 且 completed
      // （DSH 的 completed 语义 =「完成且用户尚未打开」）的转变。
      const sessionList = useSyncExternalStore(
        (cb) => sessions?.list?.subscribe(cb) ?? (() => {}),
        () => sessions?.list?.getSnapshot(),
      )
      const prevRunningRef = useRef(null)
      const [notify, setNotify] = useState(null)
      // 点击回应：点击鲸鱼娘时做一下 squash 弹跳，动画结束自动清除
      const [tapped, setTapped] = useState(false)
      const tapTimerRef = useRef(null)
      // 面板 tab：当前用量 / 历史趋势
      const [tab, setTab] = useState('current')
      const [daily, setDaily] = useState(null)
      const [messages, setMessages] = useState(null)

      const anyRunning = Object.values(sessionList?.byId ?? {}).some((s) => s.running === true)

      useEffect(() => {
        if (sessionList === undefined || sessionList.phase !== 'ready') return
        const byId = sessionList.byId ?? {}
        const now = new Map(Object.entries(byId).map(([id, s]) => [id, s.running]))
        const prev = prevRunningRef.current
        if (prev !== null) {
          for (const [id, running] of now) {
            if (running === false && prev.get(id) === true) {
              const summary = byId[id]
              if (summary?.completed) {
                setNotify({ sessionId: id, title: summary.displayTitle ?? id })
              }
            }
          }
        }
        prevRunningRef.current = now
      }, [sessionList])

      const openDoneSession = useCallback(() => {
        if (notify === null) return
        const id = notify.sessionId
        setNotify(null)
        try { sessions?.open?.(id) } catch { /* 跳转失败无妨 */ }
      }, [notify, sessions])

      // 调试/自测钩子：控制台执行 window.__whalePurseNotify?.('任务标题') 可直接触发提醒
      useEffect(() => {
        window.__whalePurseNotify = (title) => setNotify({
          sessionId: '',
          title: typeof title === 'string' && title !== '' ? title : '测试任务',
        })
        return () => { delete window.__whalePurseNotify }
      }, [])
      const [view, setView] = useState(null)
      const [cost, setCost] = useState(null)
      const [balanceFailure, setBalanceFailure] = useState(false)
      const lowNotifiedRef = useRef(false)
      const [settingsOpen, setSettingsOpen] = useState(false)
      const [settings, setSettings] = useState(null)
      const [settingsDraft, setSettingsDraft] = useState(null)
      const [settingsError, setSettingsError] = useState(false)
      const [savingSettings, setSavingSettings] = useState(false)
      const [settingsSaveState, setSettingsSaveState] = useState('idle')
      const [open, setOpen] = useState(false)
      const [panelPos, setPanelPos] = useState(null)
      const [ballPos, setBallPos] = useState(loadBallPos)
      const [dragging, setDragging] = useState(false)
      const [hover, setHover] = useState(false)
      const ballRef = useRef(null)
      const panelRef = useRef(null)
      const dragRef = useRef(null)

      // 只抬升包含本桌宠的 shell.overlay：better-sidebar 的 Explorer z-index 50~60
      // 会盖住默认的 overlay 层，但全局 CSS 抬高会影响所有 overlay 插件。
      useLayoutEffect(() => {
        const overlay = ballRef.current?.closest('[data-shell-overlay]')
        if (overlay === undefined) return
        overlay.dataset.whalePurse = 'active'
        return () => { delete overlay.dataset.whalePurse }
      }, [])

      const pollCost = useCallback(() => {
        fetchJson(sessionId === undefined ? '/api/whale-purse/balance/cost' : `/api/whale-purse/balance/cost?session=${encodeURIComponent(sessionId)}`)
          .then((snapshot) => setCost(snapshot), () => setCost(null))
      }, [sessionId])

      const pollBalance = useCallback(() => {
        fetchJson('/api/whale-purse/balance')
          .then((snapshot) => { setView(snapshot); setBalanceFailure(false) }, () => setBalanceFailure(true))
      }, [])

      useEffect(() => {
        pollBalance()
        pollCost()
        const balanceTimer = window.setInterval(pollBalance, BALANCE_POLL_MS)
        const costTimer = window.setInterval(pollCost, COST_POLL_MS)
        const onVisibility = () => {
          if (document.visibilityState === 'visible') {
            pollBalance()
            pollCost()
          }
        }
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
          window.clearInterval(balanceTimer)
          window.clearInterval(costTimer)
          document.removeEventListener('visibilitychange', onVisibility)
        }
      }, [pollBalance, pollCost])

      /** 面板定位：始终贴在人物正上方（水平居中），不落到人物下方。 */
      const openPanel = useCallback(() => {
        const rect = ballRef.current?.getBoundingClientRect()
        if (rect === undefined) return
        const margin = 6
        const panelWidth = 290
        // 水平居中于人物
        let left = rect.left + rect.width / 2 - panelWidth / 2
        left = Math.max(margin, Math.min(left, window.innerWidth - panelWidth - margin))
        // 垂直：bottom 定位，面板底缘固定在人物头顶上方
        setPanelPos({ left, bottom: window.innerHeight - rect.top + margin })
        setOpen(true)
      }, [])

      const closePanel = useCallback(() => { setOpen(false); setPanelPos(null) }, [])

      // ---- 拖拽：位移 >4px 算拖动（记位置），否则算点击（开/关面板） ----
      const onBallPointerDown = useCallback((event) => {
        if (event.button !== 0 && event.pointerType === 'mouse') return
        dragRef.current = {
          startX: event.clientX,
          startY: event.clientY,
          baseX: ballPos.x,
          baseY: ballPos.y,
          moved: false,
        }
        setDragging(true)
        try { ballRef.current?.setPointerCapture(event.pointerId) } catch { /* 无妨 */ }
      }, [ballPos])

      const onBallPointerMove = useCallback((event) => {
        const drag = dragRef.current
        if (drag === null) return
        const dx = event.clientX - drag.startX
        const dy = event.clientY - drag.startY
        if (!drag.moved && Math.hypot(dx, dy) > 4) drag.moved = true
        if (drag.moved) {
          setBallPos(clampBallPos({ x: drag.baseX + dx, y: drag.baseY + dy }))
          if (open) closePanel()
        }
      }, [open, closePanel])

      const onBallPointerUp = useCallback((event) => {
        const drag = dragRef.current
        dragRef.current = null
        setDragging(false)
        try { ballRef.current?.releasePointerCapture(event.pointerId) } catch { /* 无妨 */ }
        if (drag === null) return
        if (drag.moved) {
          try { window.localStorage.setItem(BALL_STORAGE_KEY, JSON.stringify(ballPos)) } catch { /* 无妨 */ }
        } else {
          setTapped(true)
          if (tapTimerRef.current !== null) clearTimeout(tapTimerRef.current)
          tapTimerRef.current = setTimeout(() => setTapped(false), 450)
          open ? closePanel() : openPanel()
        }
      }, [ballPos, open, openPanel, closePanel])

      // 视口变化时始终把球夹回视口内（大屏→小屏切换后不会丢鲸鱼娘），
      // 与面板是否打开无关。
      useEffect(() => {
        const onResize = () => { setBallPos((p) => clampBallPos(p)) }
        const onVisibility = () => {
          if (document.visibilityState === 'visible') setBallPos((p) => clampBallPos(p))
        }
        window.addEventListener('resize', onResize)
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
          window.removeEventListener('resize', onResize)
          document.removeEventListener('visibilitychange', onVisibility)
        }
      }, [])

      useEffect(() => {
        if (!open) return
        const onPointerDown = (event) => {
          const target = event.target
          if (ballRef.current?.contains(target) || panelRef.current?.contains(target)) return
          closePanel()
        }
        const onResize = () => closePanel()
        document.addEventListener('pointerdown', onPointerDown)
        window.addEventListener('resize', onResize)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown)
          window.removeEventListener('resize', onResize)
        }


      }, [open, closePanel])
      const loadSettings = useCallback(() => {
        fetchJson('/api/whale-purse/settings')
          .then((snapshot) => {
            setSettingsError(false)
            setSettings(snapshot)
            setSettingsDraft({
              model: snapshot.model ?? 'auto',
              lowBalanceThreshold: snapshot.lowBalanceThreshold ?? 10,
              dailyBudget: snapshot.dailyBudget ?? '',
            })
          }, () => { setSettingsError(true); setSettings(null) })
      }, [])

      const refresh = useCallback(() => {
        fetchJson('/api/whale-purse/balance/refresh')
          .then((snapshot) => { setView(snapshot); setBalanceFailure(false) }, () => setBalanceFailure(true))
      }, [])

      const pollHistory = useCallback(() => {
        if (sessionId === undefined) return
        fetchJson('/api/whale-purse/balance/daily?days=7')
          .then((snapshot) => setDaily(snapshot), () => setDaily(null))
        fetchJson(`/api/whale-purse/balance/messages?session=${encodeURIComponent(sessionId)}&limit=20`)
          .then((snapshot) => setMessages(snapshot), () => setMessages(null))
      }, [sessionId])

      useEffect(() => {
        if (!open) return
        pollHistory()
        const timer = window.setInterval(pollHistory, 10_000)
        return () => window.clearInterval(timer)
      }, [open, tab, pollHistory])

      // ---- 球内容 ----

      const saveSettings = useCallback(() => {
        if (settingsDraft === null || savingSettings) return
        setSavingSettings(true)
        setSettingsSaveState('saving')
        fetch('/api/whale-purse/settings', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: settingsDraft.model,
            lowBalanceThreshold: Number(settingsDraft.lowBalanceThreshold),
            dailyBudget: settingsDraft.dailyBudget === '' ? null : Number(settingsDraft.dailyBudget),
          }),
        })
          .then((response) => response.json())
          .then((snapshot) => {
            setSettingsError(false)
            setSettings(snapshot)
            setSettingsDraft({
              model: snapshot.model ?? 'auto',
              lowBalanceThreshold: snapshot.lowBalanceThreshold ?? 10,
              dailyBudget: snapshot.dailyBudget ?? '',
            })
            setSavingSettings(false)
            setSettingsSaveState('saved')
            setTimeout(() => setSettingsSaveState('idle'), 2000)
            pollBalance()
            pollHistory()
          }, () => { setSettingsError(true); setSavingSettings(false); setSettingsSaveState('error') })
      }, [settingsDraft, savingSettings, pollBalance, pollHistory])

      useEffect(() => {
        if (settingsOpen) loadSettings()
      }, [settingsOpen, loadSettings])

      const balanceView = view
      const hasBalance = balanceView !== null && balanceView.error === undefined && balanceView.total !== undefined && balanceView.currency !== undefined
      const balanceStale = balanceFailure && hasBalance
      const balanceError = balanceFailure || balanceView === null || balanceView.error !== undefined
      const costOk = cost !== null && cost.ok === true && Number.isFinite(cost.cost)

      const ballTitle = balanceStale
        ? t('whale-purse.staleHint')
        : balanceError
          ? `${t('whale-purse.balanceUnavailable')}${balanceView?.error ? ` — ${prettyError(balanceView.error)}` : ''}`
          : balanceView !== null && balanceView.fetchedAt > 0
            ? t('whale-purse.updatedAt', { time: fmtTime(balanceView.fetchedAt) })
            : undefined

      const ballVal = hasBalance ? `¥${fmtBallShort(balanceView.total)}` : '¥--'
      const dotClass = hasBalance
        ? balanceFailure
          ? 'wp-ball-dot-loading'
          : balanceView.lowBalance
            ? 'wp-ball-dot-err'
            : 'wp-ball-dot-ok'
        : balanceError ? 'wp-ball-dot-err' : 'wp-ball-dot-loading'

      // 低余额一次性提醒（浏览器 Notification 仅在有权限时发，不强求权限）。
      useEffect(() => {
        if (hasBalance && balanceView.lowBalance) {
          if (!lowNotifiedRef.current) {
            lowNotifiedRef.current = true
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
              try {
                new Notification('whale-purse', { body: t('whale-purse.lowBalance', { amount: fmtBalance(balanceView.total) }) })
              } catch { /* 无妨 */ }
            }
          }
        } else if (hasBalance && !balanceView.lowBalance) {
          lowNotifiedRef.current = false
        }
      }, [hasBalance, balanceView, t])

      const tipLines = []
      if (balanceView !== null && balanceView.fetchedAt > 0) {
        tipLines.push(`${t('whale-purse.balance')} ${t('whale-purse.updatedAt', { time: fmtTime(balanceView.fetchedAt) })}`)
      }
      if (costOk) {
        tipLines.push(cost.pricing?.model === 'other'
          ? t('whale-purse.nonDeepSeek')
          : `${t('whale-purse.sessionCost')} ¥${fmtMoney(cost.cost)}`)
      }

      return h(Fragment, null,
        h('div', {
          ref: ballRef,
          className: `wp-ball${dragging ? ' wp-ball-dragging' : ''}${notify !== null ? ' wp-ball-bounce' : ''}`,
          style: { left: `${ballPos.x}px`, top: `${ballPos.y}px` },
          onPointerDown: onBallPointerDown,
          onPointerMove: onBallPointerMove,
          onPointerUp: onBallPointerUp,
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          title: ballTitle,
          role: 'button',
          'aria-expanded': open,
          'data-testid': 'whale-purse-ball',
        },
          h('div', { className: 'wp-ball-top', 'aria-hidden': true },
            h('span', { className: `wp-ball-dot ${dotClass}` }),
            h('span', { key: ballVal, className: 'wp-ball-pill', style: { animation: 'wp-pop-val .25s ease-out' } }, ballVal),
          ),
          h('div', { className: 'wp-ball-ground', 'aria-hidden': true }),
          anyRunning && h('div', { className: 'wp-ball-busy-tag', 'aria-hidden': true }, '忙…'),
          h('img', {
            className: `wp-ball-whale${tapped ? ' wp-whale-tap' : anyRunning ? ' wp-whale-busy' : ''}`,
            src: WHALE_SPRITE,
            alt: '',
            draggable: false,
            'aria-hidden': true,
          }),
        ),
        notify !== null && h('div', {
          className: 'wp-ball-notify',
          style: {
            left: `${Math.min(ballPos.x + BALL_W / 2, window.innerWidth - 130)}px`,
            top: `${ballPos.y + 22}px`,
            transform: 'translate(-50%, -100%)',
          },
          onClick: openDoneSession,
          role: 'button',
          'data-testid': 'whale-purse-notify',
        }, t('whale-purse.taskDone', { title: notify.title })),
        hover && tipLines.length > 0 && h('div', {
          className: 'wp-ball-tip',
          style: {
            left: `${Math.min(ballPos.x + BALL_W / 2, window.innerWidth - 140)}px`,
            top: `${ballPos.y - 4}px`,
            transform: 'translate(-50%, -100%)',
          },
          role: 'tooltip',
        }, tipLines.join(' · ')),
        open && panelPos !== null && h('aside', {
          ref: panelRef,
          className: 'wp-panel',
          style: {
            left: `${panelPos.left}px`,
            ...(panelPos.top !== undefined
              ? { top: `${panelPos.top}px` }
              : { bottom: `${panelPos.bottom}px` }),
          },
          role: 'dialog',
          'data-testid': 'whale-purse-panel',
        },
          h('header', { className: 'wp-head' },
            h('span', { className: 'wp-title' }, t('whale-purse.title')),
            h('span', { style: { display: 'inline-flex', gap: '4px' } },
              h('button', {
                type: 'button',
                className: 'wp-refresh',
                onClick: refresh,
                title: t('whale-purse.refresh'),
                'aria-label': t('whale-purse.refresh'),
              }, '⟳'),
              h('button', {
                type: 'button',
                className: `wp-settings-btn${settingsOpen ? ' wp-settings-btn-active' : ''}`,
                onClick: () => setSettingsOpen((v) => !v),
                title: t('whale-purse.settings'),
                'aria-label': t('whale-purse.settings'),
              }, '⚙'),
            ),
          ),
          settingsOpen && h('div', { className: 'wp-settings' },
            h('div', { className: 'wp-sec-label' }, t('whale-purse.settingsTitle')),
            settingsError && h('div', { className: 'wp-err' }, t('whale-purse.settingsRestartHint')),
            h('label', { className: 'wp-field' },
              h('span', { className: 'wp-field-label' }, t('whale-purse.model')),
              h('select', {
                className: 'wp-input',
                value: settingsDraft?.model ?? 'auto',
                onChange: (e) => setSettingsDraft((d) => ({ ...d, model: e.target.value })),
              },
                h('option', { value: 'auto' }, 'auto'),
                h('option', { value: 'pro' }, 'pro'),
                h('option', { value: 'flash' }, 'flash'),
              ),
            ),
            h('label', { className: 'wp-field' },
              h('span', { className: 'wp-field-label' }, t('whale-purse.lowBalanceThreshold')),
              h('input', {
                type: 'number', min: 0, step: 0.01, className: 'wp-input',
                value: settingsDraft?.lowBalanceThreshold ?? '',
                onChange: (e) => setSettingsDraft((d) => ({ ...d, lowBalanceThreshold: e.target.value })),
              }),
            ),
            h('label', { className: 'wp-field' },
              h('span', { className: 'wp-field-label' }, t('whale-purse.dailyBudget')),
              h('input', {
                type: 'number', min: 0, step: 0.01, className: 'wp-input',
                value: settingsDraft?.dailyBudget ?? '',
                onChange: (e) => setSettingsDraft((d) => ({ ...d, dailyBudget: e.target.value })),
              }),
            ),
            h('button', {
              type: 'button', className: 'wp-save',
              disabled: savingSettings || settingsDraft === null,
              onClick: saveSettings,
            }, savingSettings
              ? t('whale-purse.saving')
              : settingsSaveState === 'saved'
                ? t('whale-purse.saved')
                : t('whale-purse.save')),
            settingsSaveState === 'error' && h('div', { className: 'wp-err' }, t('whale-purse.saveFailed')),
          ),
          !settingsOpen && h('div', { className: 'wp-tabs' },
            h('button', {

              type: 'button',
              className: `wp-tab${tab === 'current' ? ' wp-tab-active' : ''}`,
              onClick: () => setTab('current'),
              'data-testid': 'whale-purse-tab-current',
            }, t('whale-purse.tabCurrent')),
            h('button', {
              type: 'button',
              className: `wp-tab${tab === 'history' ? ' wp-tab-active' : ''}`,
              onClick: () => setTab('history'),
              'data-testid': 'whale-purse-tab-history',
            }, t('whale-purse.tabHistory')),
          ),
          !settingsOpen && tab === 'current' && h(Fragment, null,
          h('section', { className: 'wp-sec' },
            h('div', { className: 'wp-sec-label' }, t('whale-purse.balance')),
            balanceView !== null && balanceView.balances !== undefined && balanceView.balances.map((b) => {
              const total = Number(b.total_balance)
              const granted = Number(b.granted_balance)
              const toppedUp = Number(b.topped_up_balance)
              const available = balanceView.available
              return h('div', { className: 'wp-bal-row', key: b.currency },
                h('div', null,
                  h('div', { className: 'wp-bal-total' },
                    `¥${fmtBalance(total)}`,
                    h('span', { className: 'wp-currency' }, b.currency),
                  ),
                  h('div', { className: 'wp-bal-sub' },
                    `${t('whale-purse.toppedUp')} ¥${fmtBalance(toppedUp)} · ${t('whale-purse.granted')} ¥${fmtBalance(granted)}`,
                  ),
                ),
                h('span', { className: `wp-avail ${available ? 'wp-avail-ok' : 'wp-avail-err'}` },
                  h('i', { className: `wp-dot ${available ? 'wp-dot-ok' : 'wp-dot-err'}`, 'aria-hidden': true }),
                  available ? t('whale-purse.available') : t('whale-purse.unavailable'),
                ),
              )
            }),
            hasBalance && balanceView.lowBalance && h('div', { className: 'wp-err' },
              t('whale-purse.lowBalance', { amount: fmtBalance(balanceView.total) }),
            ),
            daily?.budgetExceeded && h('div', { className: 'wp-err' }, t('whale-purse.budgetExceeded')),
            balanceStale && h('div', { className: 'wp-err' }, t('whale-purse.staleHint')),
            !balanceStale && balanceError && h('div', { className: 'wp-err' },
              prettyError(balanceView?.error) ?? t('whale-purse.loading'),
              balanceError && balanceView !== null && h('div', { className: 'wp-updated' }, `(${t('whale-purse.retryHint')})`),
            ),
          ),
          costOk && h('section', { className: 'wp-sec' },
            h('div', { className: 'wp-sec-label' }, t('whale-purse.sessionCost')),
            cost.pricing?.model === 'other'
              ? h('div', { className: 'wp-empty' }, t('whale-purse.nonDeepSeek'))
              : h(Fragment, null,
                h('div', { className: 'wp-cost-total' },
                  `¥${fmtMoney(cost.cost)}`,
                  h('span', { className: 'wp-currency' }, cost.currency ?? 'CNY'),
                ),
                BUCKETS.map((bucket) => {
                  const tokens = cost[bucket.tokens] ?? 0
                  const amount = cost.breakdown?.[bucket.key] ?? 0
                  return h('div', { className: 'wp-bucket', key: bucket.key },
                    h('div', { className: 'wp-bucket-line' },
                      h('span', { className: 'wp-bucket-name' },
                        h('i', { style: { background: bucket.color }, 'aria-hidden': true }),
                        t(bucket.labelKey),
                      ),
                      h('span', { className: 'wp-bucket-meta' }, `${fmtTokens(tokens)} tok · ¥${fmtMoney(amount)}`),
                    ),
                    h('span', { className: 'wp-bar' },
                      h('i', {
                        style: {
                          width: `${Math.round((tokens / Math.max(costMaxTokens(cost), 1)) * 100)}%`,
                          background: bucket.color,
                          opacity: tokens > 0 ? 1 : 0,
                        },
                      }),
                    ),
                  )
                }),
                h('div', { className: 'wp-sum' },
                  t('whale-purse.sumTokens', { tokens: fmtTokens(costTotalTokens(cost)) }),
                  ' · ',
                  t('whale-purse.cacheWriteFree'),
                ),
              ),
          ),
          h('footer', { className: 'wp-foot' },
            costOk && cost.pricing !== undefined && cost.pricing.model !== 'other' && h('div', { className: 'wp-price' },
              h('b', null, cost.pricing.model === 'pro' ? 'deepseek-v4-pro' : 'deepseek-v4-flash'),
              ` · 输入 ¥${fmtMoney(cost.pricing.inputPerMillion)}/1M · 命中 ¥${fmtMoney(cost.pricing.cacheReadPerMillion)}/1M · 输出 ¥${fmtMoney(cost.pricing.outputPerMillion)}/1M`,
            ),
            costOk && cost.pricing !== undefined && cost.pricing.peakPricingActive && cost.pricing.band !== 'standard'
              && h('div', { className: `wp-band ${cost.pricing.band === 'off-peak' ? 'wp-band-off' : ''}` },
                cost.pricing.band === 'peak' ? t('whale-purse.peak') : t('whale-purse.offPeak'),
                cost.pricing.nextChangeAt > 0 && h('span', null,
                  ' · ',
                  t(cost.pricing.band === 'peak' ? 'whale-purse.nextOffPeak' : 'whale-purse.nextPeak', {
                    time: fmtDuration(cost.pricing.nextChangeAt - Date.now()),
                  }),
                ),
              ),
            balanceView !== null && balanceView.fetchedAt > 0
              && h('div', { className: 'wp-updated' },
                h('span', null, t('whale-purse.updatedAt', { time: fmtTime(balanceView.fetchedAt) })),
                h('a', { href: PRICING_PAGE_URL, target: '_blank', rel: 'noreferrer' }, t('whale-purse.officialPricing')),
              ),
          ),
          ),
          !settingsOpen && tab === 'history' && h(Fragment, null,
            h('section', { className: 'wp-sec' },
              h('div', { className: 'wp-sec-label-row' },
                h('span', { className: 'wp-sec-label' }, t('whale-purse.dailyCost')),
                daily?.items?.length
                  ? h('span', { className: 'wp-sec-sum' }, `合计 ¥${fmtMoney(daily.items.reduce((s, d) => s + d.cost, 0))}`)
                  : null,
              ),
              daily?.coverage === 'live' && h('div', { className: 'wp-sec-sum' }, t('whale-purse.liveOnlyHint')),
              daily?.items?.length
                ? (() => {
                  const maxCost = Math.max(...daily.items.map((x) => x.cost), 0.0001)
                  return h('div', { className: 'wp-chart', 'data-testid': 'whale-purse-chart' },
                    daily.items.map((d) => h('div', { className: 'wp-chart-col', key: d.date },
                      h('span', { className: 'wp-chart-val' }, d.cost > 0 ? fmtMoneyShort(d.cost) : ''),
                      h('div', {
                        className: `wp-chart-bar${d.cost > 0 ? '' : ' wp-chart-bar-zero'}`,
                        style: { height: `${Math.max(2, Math.round((d.cost / maxCost) * 68))}px` },
                      }),
                      h('span', { className: 'wp-chart-label' }, fmtDateShort(d.date)),
                    )),
                  )
                })()
                : h('div', { className: 'wp-empty' }, t('whale-purse.noData')),
            ),
            h('section', { className: 'wp-sec' },
              h('div', { className: 'wp-sec-label-row' },
                h('span', { className: 'wp-sec-label' }, t('whale-purse.msgCost')),
                messages?.items?.length
                  ? h('span', { className: 'wp-sec-sum' }, `合计 ¥${fmtMoney3(messages.items.reduce((s, m) => s + m.cost, 0))}`)
                  : null,
              ),
              messages?.items?.length
                ? h('div', null,
                  h('div', { className: 'wp-msg-head' },
                    h('span', { className: 'wp-msg-q' }, t('whale-purse.question')),
                    h('span', { className: 'wp-msg-tokens' }, 'Tokens'),
                    h('span', { className: 'wp-msg-cost' }, t('whale-purse.cost')),
                  ),
                  h('div', { className: 'wp-msg-list' },
                    messages.items.map((m, i) => {
                      const question = m.question || '…'
                      const shortQ = question.length > 10 ? `${question.slice(0, 10)}…` : question
                      return h('div', { className: 'wp-msg-row', key: `${m.time}-${i}` },
                        h('span', { className: 'wp-msg-q', title: question }, shortQ),
                        h('span', { className: 'wp-msg-tokens' }, fmtTokens(m.tokens)),
                        h('span', { className: 'wp-msg-cost' }, `¥${fmtMoney3(m.cost)}`),
                      )
                    }),
                  ),
                )
                : h('div', { className: 'wp-empty' },
                  cost.pricing?.model === 'other' ? t('whale-purse.nonDeepSeek') : t('whale-purse.noData'),
                ),
            ),
          ),
        ),
      )
    }

    function costMaxTokens(cost) {
      let max = 1
      for (const bucket of BUCKETS) max = Math.max(max, cost[bucket.tokens] ?? 0)
      return max
    }

    function costTotalTokens(cost) {
      let sum = 0
      for (const bucket of BUCKETS) sum += cost[bucket.tokens] ?? 0
      return sum
    }

    // ---------------------------------------------------------------------
    // 插件面
    // ---------------------------------------------------------------------
    const inject = ['slots', 'locale', 'connection', 'sessions']

    function apply(ctx) {
      installCss()
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'whale-purse: dictionaries')
      ctx.inject(['slots', 'sessions'], (scope) => {
        scope.effect(() => scope.slots.register({
          name: 'shell.overlay',
          id: 'whale-purse',
          order: 130,
          locale: NS,
          inject: () => ({ sessions: scope.get('sessions') }),
        }, UsageMeter), 'whale-purse: shell overlay registration')
      })
    }

    return { apply, inject, UsageMeter }
  },
})
