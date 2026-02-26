const form = document.getElementById("uploadForm");
const statusEl = document.getElementById("status");
const resultSection = document.getElementById("resultSection");
const resultText = document.getElementById("resultText");
const submitBtn = document.getElementById("submitBtn");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  statusEl.textContent = "上傳中，請稍候...";
  resultSection.hidden = true;
  resultText.textContent = "";
  submitBtn.disabled = true;

  try {
    const formData = new FormData(form);

    const response = await fetch("/analyze", {
      method: "POST",
      body: formData
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "分析失敗，請稍後再試");
    }

    statusEl.textContent = "分析完成";
    resultText.textContent = data.result || "（沒有回覆內容）";
    resultSection.hidden = false;
  } catch (err) {
    statusEl.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
  }
});
