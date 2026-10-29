// قبل از رندر صفحه اجرا می‌شود تا تم بدون «چشمک» اعمال شود.
(function () {
  try {
    var t = localStorage.getItem('theme') ||
      (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) { document.documentElement.setAttribute('data-theme', 'light'); }
})();
