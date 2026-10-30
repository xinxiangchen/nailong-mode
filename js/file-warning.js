// 直接双击 index.html 时模块和摄像头都会失效，先给个明确提示。
if (location.protocol === 'file:') {
  window.addEventListener('DOMContentLoaded', function () {
    var text = document.getElementById('introStatusText');
    if (text) {
      text.textContent =
        '请先运行 start.ps1（或 python server.py），再通过 http://127.0.0.1:8899 打开。直接双击 HTML 无法使用摄像头。';
    }
    var status = document.getElementById('introStatus');
    if (status) status.classList.add('is-error');
  });
}
