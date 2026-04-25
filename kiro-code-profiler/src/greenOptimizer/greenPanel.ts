import * as vscode from "vscode";
import { LLMEngine } from "./llmEngine";

export class GreenOptimizerPanel {
  public static currentPanel: GreenOptimizerPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _engine: LLMEngine;
  private _disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel) {
    this._panel = panel;
    this._engine = new LLMEngine();
    this._panel.webview.html = this._getHtml();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(async (msg) => {
      try {
        switch (msg.type) {
          case "analyze": {
            const wp = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!wp) { this.send("error", { message: "No workspace open" }); return; }
            const result = await this._engine.analyzeWorkspace(wp, (s) => this.send("progress", { message: s }));
            this.send("analysisResult", { ...result, debugLog: this._engine.getDebugLog() });
            break;
          }
          case "accept": {
            const res = await this._engine.acceptSuggestion(msg.id);
            const impact = this._engine.getImpactSummary();
            this.send("actionResult", { id: msg.id, action: "accepted", ...res, impact, suggestions: this._engine.getSuggestions() });
            if (res.success) {
              const s = this._engine.getSuggestions().find(x => x.suggestionId === msg.id);
              if (s) {
                const doc = await vscode.workspace.openTextDocument(s.filePath);
                const ed = await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
                ed.revealRange(new vscode.Range(Math.max(0, s.startLine - 1), 0, s.endLine, 0), vscode.TextEditorRevealType.InCenter);
                vscode.window.showInformationMessage("🌿 Applied: " + s.description);
              }
            } else {
              vscode.window.showErrorMessage("Failed: " + (res.error || "Unknown"));
            }
            break;
          }
          case "reject": {
            this._engine.rejectSuggestion(msg.id);
            const impact = this._engine.getImpactSummary();
            this.send("actionResult", { id: msg.id, action: "rejected", success: true, impact, suggestions: this._engine.getSuggestions() });
            break;
          }
          case "navigate": {
            const s = this._engine.getSuggestions().find(x => x.suggestionId === msg.id);
            if (s) {
              const doc = await vscode.workspace.openTextDocument(s.filePath);
              const ed = await vscode.window.showTextDocument(doc, { preview: false });
              ed.revealRange(new vscode.Range(Math.max(0, s.startLine - 1), 0, s.endLine, 0), vscode.TextEditorRevealType.InCenter);
            }
            break;
          }
        }
      } catch (err: any) {
        this.send("error", { message: err.message || "Unknown error" });
      }
    }, null, this._disposables);
  }

  private send(type: string, data: any) { this._panel.webview.postMessage({ type, ...data }); }

  static createOrShow(extensionUri: vscode.Uri): GreenOptimizerPanel {
    if (GreenOptimizerPanel.currentPanel) { GreenOptimizerPanel.currentPanel._panel.reveal(); return GreenOptimizerPanel.currentPanel; }
    const panel = vscode.window.createWebviewPanel("greenCodeOptimizer", "🌿 Green Code Optimizer", vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
    GreenOptimizerPanel.currentPanel = new GreenOptimizerPanel(panel);
    return GreenOptimizerPanel.currentPanel;
  }

  dispose() { GreenOptimizerPanel.currentPanel = undefined; this._panel.dispose(); this._disposables.forEach(d => d.dispose()); }

  private _getHtml(): string {
    return /*html*/`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:var(--vscode-font-family,sans-serif);font-size:13px;background:var(--vscode-editor-background,#1e1e1e);color:var(--vscode-editor-foreground,#d4d4d4);padding:16px;overflow-y:auto}
.hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}
.hdr h1{font-size:20px;color:#58d68d}
.btn{border:none;border-radius:6px;padding:10px 24px;font-size:14px;font-weight:600;cursor:pointer;background:linear-gradient(135deg,#27ae60,#2ecc71);color:#fff}
.btn:disabled{opacity:.5;cursor:not-allowed}
.spin{display:inline-block;width:16px;height:16px;border:2px solid #fff;border-top-color:transparent;border-radius:50%;animation:sp .7s linear infinite;vertical-align:middle;margin-right:6px}
@keyframes sp{to{transform:rotate(360deg)}}
.st{font-size:12px;color:#888;margin-top:8px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px}
.card{background:var(--vscode-editorWidget-background,#252526);border:1px solid var(--vscode-panel-border,#444);border-radius:8px;padding:14px;text-align:center}
.card.a{border-color:#27ae60}
.card .v{font-size:22px;font-weight:700;color:#58d68d;margin:6px 0}
.card .l{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px}
.card .s{font-size:10px;color:#666}
.sug{background:var(--vscode-editorWidget-background,#252526);border:1px solid var(--vscode-panel-border,#444);border-radius:8px;padding:12px;margin-bottom:10px}
.sug .sh{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.sug .st2{font-weight:600;cursor:pointer}.sug .st2:hover{color:#58d68d}
.sug .sm{font-size:11px;color:#888;margin-bottom:6px}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;text-transform:uppercase}
.badge.high{background:#1a3a2a;color:#58d68d}.badge.medium{background:#3a3a1a;color:#d6c858}.badge.low{background:#3a2a1a;color:#d6a058}
.bs{display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600}
.bs.pending{background:#1a2a3a;color:#58a6d6}.bs.accepted{background:#1a3a2a;color:#58d68d}.bs.rejected{background:#3a1a1a;color:#d65858}
.dr{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}
.cl{font-size:10px;font-weight:600;text-transform:uppercase;margin-bottom:2px;letter-spacing:.5px}
.cl.o{color:#e74c3c}.cl.p{color:#27ae60}
.cb{background:var(--vscode-textCodeBlock-background,#1a1a1a);border-radius:4px;padding:8px;font-family:monospace;font-size:11px;white-space:pre-wrap;max-height:150px;overflow-y:auto;border:1px solid var(--vscode-panel-border,#333)}
.cb.orig{border-left:3px solid #e74c3c}.cb.prop{border-left:3px solid #27ae60}
.acts{display:flex;gap:6px}
.ab,.rb{padding:5px 14px;border-radius:4px;border:1px solid;font-size:11px;cursor:pointer;font-weight:600;background:transparent}
.ab{border-color:#27ae60;color:#58d68d}.ab:hover{background:#27ae60;color:#fff}
.rb{border-color:#e74c3c;color:#d65858}.rb:hover{background:#e74c3c;color:#fff}
.ab:disabled,.rb:disabled{opacity:.3;cursor:not-allowed}
.empty{text-align:center;padding:40px;color:#666}
.hidden{display:none}
.imp{margin-top:20px;padding:16px;background:var(--vscode-editorWidget-background,#252526);border:1px solid #27ae60;border-radius:8px}
.eq{display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap}
.eqc{background:var(--vscode-editorWidget-background,#252526);border:1px solid var(--vscode-panel-border,#444);border-radius:8px;padding:12px 16px;flex:1;min-width:220px;display:flex;align-items:center;gap:10px}
.sec{font-size:15px;font-weight:600;margin:16px 0 10px}
.count{background:#1a2a3a;border:1px solid var(--vscode-panel-border,#444);border-radius:8px;padding:14px;text-align:center;margin-bottom:20px}
.count .v{font-size:28px;font-weight:700;color:#58a6d6}
.count .l{font-size:11px;color:#888;text-transform:uppercase}
</style></head><body>
<div class="hdr"><h1>🌿 Green Code Optimizer</h1>
<button class="btn" id="btn" onclick="doAnalyze()"><span id="btxt">🤖 AI Optimize Codebase</span></button></div>
<div class="st" id="st">Click to scan — AI will identify inefficiencies and generate optimized code</div>
<div id="empty" class="empty"><div style="font-size:48px;margin-bottom:12px">🔍</div><p>No analysis results yet</p></div>
<div id="res" class="hidden">
<div class="count" id="countCard"></div>
<div class="sec">📋 Review & Apply Suggestions</div>
<div style="font-size:12px;color:#888;margin-bottom:12px">Accept or reject each suggestion. Impact dashboard appears after you make changes.</div>
<div id="slist"></div>
<div id="imp" class="imp hidden"></div>
</div>
<script>
const vs=acquireVsCodeApi();
function doAnalyze(){
  document.getElementById('btn').disabled=true;
  document.getElementById('btxt').innerHTML='<span class="spin"></span> Scanning with AI...';
  document.getElementById('st').textContent='Starting AI analysis...';
  vs.postMessage({type:'analyze'});
}
window.addEventListener('message',e=>{
  const m=e.data;
  if(m.type==='progress'){document.getElementById('st').textContent=m.message;return;}
  if(m.type==='error'){
    document.getElementById('btn').disabled=false;
    document.getElementById('btxt').textContent='🤖 AI Optimize Codebase';
    document.getElementById('st').textContent='Error: '+m.message;return;
  }
  if(m.type==='analysisResult'){
    document.getElementById('btn').disabled=false;
    document.getElementById('btxt').textContent='🤖 Re-analyze';
    document.getElementById('st').textContent='Scanned '+m.scannedFiles+' files · Found '+m.suggestions.length+' issues · '+m.skippedFiles+' skipped';
    document.getElementById('empty').classList.add('hidden');
    document.getElementById('res').classList.remove('hidden');
    document.getElementById('countCard').innerHTML='<div class="l">Issues Found</div><div class="v">'+m.suggestions.length+'</div><div class="l">Accept or reject each to see impact</div>';
    renderSugs(m.suggestions);
    document.getElementById('imp').classList.add('hidden');
    return;
  }
  if(m.type==='actionResult'){
    if(!m.success&&m.action==='accepted')alert('Failed: '+(m.error||'Unknown'));
    renderSugs(m.suggestions);
    if(m.impact.acceptedCount>0||m.impact.rejectedCount>0) showImpact(m.impact);
    return;
  }
});
function renderSugs(sugs){
  let h='';
  for(const s of sugs){
    const f=s.filePath.replace(/\\\\/g,'/').split('/').pop();
    const dis=s.status!=='pending'?'disabled':'';
    h+='<div class="sug"><div class="sh"><span class="st2" data-nav="'+s.suggestionId+'">'+esc(s.description)+'</span><span class="bs '+s.status+'">'+s.status+'</span></div>';
    h+='<div class="sm"><span class="badge '+s.confidenceLevel+'">'+s.confidenceLevel+'</span> · '+esc(f)+':'+s.startLine+'-'+s.endLine+'</div>';
    h+='<div class="dr"><div><div class="cl o">❌ Current Code</div><div class="cb orig">'+esc(s.originalCode)+'</div></div>';
    h+='<div><div class="cl p">✅ Optimized Code</div><div class="cb prop">'+esc(s.proposedCode)+'</div></div></div>';
    h+='<div class="acts"><button class="ab" data-accept="'+s.suggestionId+'" '+dis+'>✓ Accept & Apply</button>';
    h+='<button class="rb" data-reject="'+s.suggestionId+'" '+dis+'>✗ Reject</button></div></div>';
  }
  document.getElementById('slist').innerHTML=h;
  document.getElementById('slist').onclick=function(ev){
    const t=ev.target;
    if(t.dataset.accept)vs.postMessage({type:'accept',id:t.dataset.accept});
    if(t.dataset.reject)vs.postMessage({type:'reject',id:t.dataset.reject});
    if(t.dataset.nav)vs.postMessage({type:'navigate',id:t.dataset.nav});
  };
}
function showImpact(imp){
  const el=document.getElementById('imp');
  el.classList.remove('hidden');
  el.innerHTML='<div class="sec">🌍 Impact Dashboard — Energy & Carbon Savings</div>'+
    '<div class="cards">'+
      mc('a','Optimizations Applied',imp.acceptedCount,imp.rejectedCount+' rejected · '+imp.pendingCount+' pending')+
      mc('a','Energy Saved',fE(imp.totalEnergySavedJoules),fE2(imp.totalEnergySavedKwh)+' kWh')+
      mc('a','CO₂ Reduced',fC(imp.totalCo2ReductionGrams),'grams CO₂ equivalent')+
      mc('','Carbon Intensity',imp.carbonIntensityFactor+' gCO₂/kWh',imp.region+' grid average (IEA 2023)')+
    '</div>'+
    '<div class="eq">'+
      '<div class="eqc"><div style="font-size:28px">📱</div><div>≈ '+imp.smartphoneCharges.toFixed(6)+' smartphone charges saved</div></div>'+
      '<div class="eqc"><div style="font-size:28px">🚗</div><div>≈ '+imp.carMeters.toFixed(6)+' meters of car driving avoided</div></div>'+
    '</div>'+
    '<div style="font-size:10px;color:#666">All figures are estimates. Energy = instructions × 1nJ × savings%. CO₂ = kWh × '+imp.carbonIntensityFactor+' gCO₂/kWh. Sources: IEA 2023, EPA eGRID 2022.</div>';
}
function mc(c,l,v,s){return '<div class="card '+c+'"><div class="l">'+l+'</div><div class="v">'+v+'</div><div class="s">'+s+'</div></div>';}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function fE(j){if(!j)return '0 J';if(j<1e-6)return (j*1e9).toFixed(1)+' nJ';if(j<1e-3)return (j*1e6).toFixed(1)+' µJ';if(j<1)return (j*1e3).toFixed(1)+' mJ';return j.toFixed(2)+' J';}
function fE2(k){return k?k.toExponential(2):'0';}
function fC(g){if(!g)return '0 g';if(g<1e-9)return (g*1e12).toFixed(1)+' pg';if(g<1e-6)return (g*1e9).toFixed(1)+' ng';if(g<1e-3)return (g*1e6).toFixed(1)+' µg';if(g<1)return (g*1e3).toFixed(1)+' mg';return g.toFixed(2)+' g';}
</script></body></html>`;
  }
}
