const bg = document.getElementById('rippleGridBg');

// WebGL 涟漪网格在部分 GPU/驱动下渲染失败（黑屏/黑杠/不动），已弃用。
// 背景层次改由 main-content 的纯 CSS 多层光斑承担（见 styles-warehouse.css），
// 这里保留容器但不再初始化 WebGL canvas，避免产生黑屏/黑条。
if (bg) {
  bg.style.display = 'none';
}
