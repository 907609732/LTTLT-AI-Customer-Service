import { app, BrowserWindow } from 'electron'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createAssistPlatformReader } from './assist-platform-reader'
import { createAssistQueryMonitor } from './assist-platform-query'
import { clickPddQuery, clickPddPage, readPddPagination } from './assist-platform-pdd'
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'lingtu-pages-')))
let requests = 0
const server = http.createServer((req, res) => {
  if (req.url?.startsWith('/query')) {
    requests++
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.write('{"ok":')
    setTimeout(() => res.end('true}'), 100)
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(`<main id="pdd-app-skeleton-main-content"></main><script>
 const savedFetch=window.fetch.bind(window);window.current=2;window.refunds=0
 const pages=[['a','b'],['b','c'],['d','e']]
 window.render=()=>{
 const rows=pages[window.current-1]
 document.querySelector('main').innerHTML='<input value="待处理"><input value="近60天内"><button id="query">查询</button><button onclick="window.refunds++">同意退款</button><header>'+['订单信息','处理进度','处理时间','操作'].map(t=>'<div class="listTable_headerCell__fixture">'+t+'</div>').join('')+'</header><p>共查询到5个工单</p>'+rows.map((id,i)=>'<div class="listItem_workOrderItem__fixture" data-fixture="'+id+'">订单号：123456789'+i+'<div class="listItem_itemCell__fixture">订单问题：测试问题</div><div class="listItem_itemCell__fixture"><div class="tableItemStatus_statusText__fixture">待处理</div></div><div class="listItem_itemCell__fixture">剩1时</div><div class="listItem_itemCell__fixture"><div class="listTable_operateBtn__fixture">立即处理</div></div></div>').join('')+'<ul class="PGT_outerWrapper_fixture"><li class="PGT_totalText_fixture">共有5条</li><li class="PGT_prev_fixture '+(window.current===1?'PGT_disabled_fixture':'')+'"></li>'+[1,2,3].map(n=>'<li class="PGT_pagerItem_fixture '+(n===window.current?'PGT_pagerItemActive_fixture':'')+'">'+n+'</li>').join('')+'<li class="PGT_next_fixture '+(window.current===3?'PGT_disabled_fixture':'')+'"></li></ul>'
 const load=async(n)=>{await(await savedFetch('/query?page='+n)).json();window.current=n;window.render()}
 document.querySelector('#query').onclick=()=>load(window.current)
 document.querySelector('[class*="PGT_next_"]').onclick=()=>load(window.current+1)
 document.querySelector('[class*="PGT_pagerItem_"]').onclick=()=>load(1)
 }
 window.render()
 </script>`)
})
app
  .whenReady()
  .then(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert(address && typeof address === 'object')
    const origin = `http://127.0.0.1:${address.port}`
    const win = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    })
    const monitor = createAssistQueryMonitor(origin)
    try {
      await win.loadURL(origin)
      const page = {
        getURL: () => 'https://mms.pinduoduo.com/aftersales/work_order/list',
        executeJavaScript: async (script: string) =>
          win.webContents.executeJavaScript(
            `(() => {const location={origin:'https://mms.pinduoduo.com',pathname:'/aftersales/work_order/list'};return ${script}})()`,
          ),
      }
      const read = createAssistPlatformReader({
        page: () => page,
        collectionPage: async () => page,
        identityScript: () => `({authenticated:true,mallId:'fixture-mall'})`,
        refreshQuery: async () =>
          monitor.run(
            win.webContents,
            async () => {
              await win.webContents.executeJavaScript(`(${clickPddQuery.toString()})()`)
            },
            async () => true,
          ),
        turnPage: async (_page, _kind, direction, expected, signal) =>
          monitor.run(
            win.webContents,
            async () => {
              await win.webContents.executeJavaScript(
                `(${clickPddPage.toString()})(${JSON.stringify(direction)},${expected})`,
              )
            },
            async () =>
              win.webContents.executeJavaScript(
                `Number(document.querySelector('[class*="PGT_pagerItemActive_"]').textContent)===${direction === 'first' ? 1 : expected + 1}`,
              ),
            signal,
          ),
        observeTicketDetail: async (_id, index) =>
          `https://mms.pinduoduo.com/aftersales/work_order/tododetail?id=${await win.webContents.executeJavaScript(`document.querySelectorAll('[data-fixture]')[${index}].dataset.fixture`)}`,
      })
      const result = await read(
        {
          id: 'fixture-store',
          platform: 'pdd-web',
          storeName: 'fixture',
          identityId: 'fixture-mall',
        },
        'ticket',
      )
      assert.equal(result.complete, true)
      assert.equal(result.total, 5)
      assert.deepEqual(
        result.items.map((item) => item.id),
        ['a', 'b', 'c', 'd', 'e'],
      )
      assert.equal(requests, 4)
      assert.equal(await win.webContents.executeJavaScript('window.refunds'), 0)
      const pagination = await win.webContents.executeJavaScript(
        `(${readPddPagination.toString()})(5,2)`,
      )
      assert.equal(pagination.current, 3)
      assert.equal(pagination.hasNext, false)
      fs.mkdirSync('artifacts/assist-pages', { recursive: true })
      fs.writeFileSync(
        'artifacts/assist-pages/report.json',
        JSON.stringify(
          {
            pass: true,
            electron: process.versions.electron,
            pages: 3,
            uniqueItems: 5,
            readonlyRequests: requests,
            refundActions: 0,
          },
          null,
          2,
        ),
      )
      console.log('原生隔离分页：3页、5条去重、4次只读查询，通过')
    } finally {
      monitor.dispose()
      win.destroy()
      server.close()
    }
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error)
    server.close()
    app.exit(1)
  })
