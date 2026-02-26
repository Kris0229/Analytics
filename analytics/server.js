import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();
const port = process.env.PORT || 5174;

app.use(express.static("public"));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function buildPrompt({ imuText, poseText, metaText }) {
  return [
    "你是Driveline的專業打擊教練，分析這個揮棒數據的優缺點，並提供訓練建議，使用Gemini 3 Pro模型。",
    "\n",
    "請根據以下三個CSV內容做分析：",
    "\n",
    "[IMU數據]",
    "```",
    imuText,
    "```",
    "\n",
    "[姿態數據]",
    "```",
    poseText,
    "```",
    "\n",
    "[Metadata]",
    "```",
    metaText,
    "```"
  ].join("\n");
}

app.post(
  "/analyze",
  upload.fields([
    { name: "imu", maxCount: 1 },
    { name: "pose", maxCount: 1 },
    { name: "meta", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const files = req.files || {};
      const imu = files.imu?.[0];
      const pose = files.pose?.[0];
      const meta = files.meta?.[0];

      if (!imu || !pose || !meta) {
        return res.status(400).json({
          error: "請上傳三個檔案：IMU數據、姿態數據、Metadata"
        });
      }

      const apiKey = requireEnv("GEMINI_API_KEY");
      const modelName = process.env.GEMINI_MODEL || "gemini-3-pro";

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: modelName });

      const prompt = buildPrompt({
        imuText: imu.buffer.toString("utf8"),
        poseText: pose.buffer.toString("utf8"),
        metaText: meta.buffer.toString("utf8")
      });

      const result = await model.generateContent(prompt);
      const text = result.response.text();

      return res.json({ result: text });
    } catch (err) {
      console.error(err);
      return res.status(500).json({
        error: err.message || "分析失敗，請稍後再試"
      });
    }
  }
);

app.listen(port, () => {
  console.log(`Analytics app running at http://localhost:${port}`);
});
