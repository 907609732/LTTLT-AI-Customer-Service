package lingtuhost

import "github.com/QuantumNous/new-api/constant"

type modelProvider struct {
	Provider         string   `json:"provider"`
	Name             string   `json:"name"`
	Category         string   `json:"category"`
	ChannelType      int      `json:"channel_type"`
	BaseURL          string   `json:"base_url"`
	UpstreamModel    string   `json:"upstream_model"`
	CredentialFormat string   `json:"credential_format"`
	RequiredFields   []string `json:"required_fields"`
	SetupURL         string   `json:"setup_url"`
}

// Adapter IDs/default endpoints are from the pinned AGPL New API native catalog.
// Model examples are form suggestions, never an implicit routing fallback.
func managedModelCatalog() []modelProvider {
	key := []string{"name", "secret", "base_url", "upstream_model"}
	rows := []modelProvider{
		{"deepseek", "DeepSeek", "domestic", constant.ChannelTypeDeepSeek, "https://api.deepseek.com", "deepseek-chat", "API Key", key, "https://platform.deepseek.com/api_keys"},
		{"qwen", "通义千问", "domestic", constant.ChannelTypeAli, "https://dashscope.aliyuncs.com", "qwen-plus", "API Key", key, "https://bailian.console.aliyun.com/"},
		{"doubao", "豆包", "domestic", constant.ChannelTypeVolcEngine, "https://ark.cn-beijing.volces.com", "", "API Key; upstream_model is your inference endpoint/model ID", key, "https://console.volcengine.com/ark"},
		{"glm", "智谱 GLM", "domestic", constant.ChannelTypeZhipu_v4, "https://open.bigmodel.cn", "glm-4-flash", "API Key", key, "https://open.bigmodel.cn/"},
		{"kimi", "Kimi", "domestic", constant.ChannelTypeMoonshot, "https://api.moonshot.cn", "moonshot-v1-8k", "API Key", key, "https://platform.moonshot.cn/"},
		{"minimax", "MiniMax", "domestic", constant.ChannelTypeMiniMax, "https://api.minimax.chat", "MiniMax-M2", "API Key", key, "https://platform.minimaxi.com/"},
		{"hunyuan", "腾讯混元", "domestic", constant.ChannelTypeTencent, "https://hunyuan.tencentcloudapi.com", "hunyuan-lite", "AppID|SecretID|SecretKey (native TC3)", key, "https://console.cloud.tencent.com/hunyuan"},
		{"baidu", "文心 / 千帆", "domestic", constant.ChannelTypeBaiduV2, "https://qianfan.baidubce.com", "ernie-4.0-8k", "API Key (Qianfan v2 bearer)", key, "https://console.bce.baidu.com/qianfan/"},
		{"spark", "讯飞星火", "domestic", constant.ChannelTypeXunfei, "https://spark-api.xf-yun.com", "SparkDesk-v3.5", "AppID|APISecret|APIKey (native WebSocket; explicit SparkDesk-v1.1/v2.1/v3.1/v3.5/v4.0 model; fixed official endpoint)", key, "https://console.xfyun.cn/"},
		{"yi", "零一万物", "domestic", constant.ChannelTypeOpenAI, "https://api.lingyiwanwu.com", "yi-large", "API Key (native OpenAI-compatible adapter)", key, "https://platform.lingyiwanwu.com/"},
		{"openai", "OpenAI", "global", constant.ChannelTypeOpenAI, "https://api.openai.com", "gpt-4o-mini", "API Key", key, "https://platform.openai.com/api-keys"},
		{"claude", "Claude", "global", constant.ChannelTypeAnthropic, "https://api.anthropic.com", "claude-sonnet-4-20250514", "API Key", key, "https://console.anthropic.com/"},
		{"gemini", "Gemini", "global", constant.ChannelTypeGemini, "https://generativelanguage.googleapis.com", "gemini-2.5-flash", "API Key", key, "https://aistudio.google.com/apikey"},
		{"grok", "Grok", "global", constant.ChannelTypeXai, "https://api.x.ai", "grok-3-mini", "API Key", key, "https://console.x.ai/"},
		{"mistral", "Mistral", "global", constant.ChannelTypeMistral, "https://api.mistral.ai", "mistral-small-latest", "API Key", key, "https://console.mistral.ai/"},
		{"cohere", "Cohere", "global", constant.ChannelTypeCohere, "https://api.cohere.ai", "command-r-plus", "API Key", key, "https://dashboard.cohere.com/"},
		{"perplexity", "Perplexity", "global", constant.ChannelTypePerplexity, "https://api.perplexity.ai", "sonar", "API Key", key, "https://www.perplexity.ai/settings/api"},
		{"siliconflow", "硅基流动", "platform", constant.ChannelTypeSiliconFlow, "https://api.siliconflow.cn", "Qwen/Qwen2.5-7B-Instruct", "API Key", key, "https://cloud.siliconflow.cn/"},
		{"openrouter", "OpenRouter", "platform", constant.ChannelTypeOpenRouter, "https://openrouter.ai/api", "", "API Key; select an explicit upstream model", key, "https://openrouter.ai/keys"},
		{"azure", "Azure OpenAI", "platform", constant.ChannelTypeAzure, "", "", "API Key; upstream_model is the deployment name", appendFields(key, "api_version"), "https://learn.microsoft.com/azure/ai-services/openai/"},
		{"bedrock", "AWS Bedrock", "platform", constant.ChannelTypeAws, "", "", "APIKey|Region or AccessKeyID|SecretAccessKey|Region; native SDK derives regional endpoint", key, "https://docs.aws.amazon.com/bedrock/"},
		{"vertex", "Vertex AI", "platform", constant.ChannelTypeVertexAi, "https://aiplatform.googleapis.com", "", "Service account JSON (project_id, client_email, private_key); fixed Google OAuth token endpoint", appendFields(key, "region"), "https://cloud.google.com/vertex-ai/docs"},
		{"cloudflare", "Cloudflare AI", "platform", constant.ChannelCloudflare, "https://api.cloudflare.com", "", "API token + account_id", appendFields(key, "account_id"), "https://developers.cloudflare.com/workers-ai/"},
		{"ollama", "Ollama", "selfhost", constant.ChannelTypeOllama, "", "", "Optional bearer key; explicit URL and model ID required", []string{"name", "base_url", "upstream_model"}, "https://docs.ollama.com/"},
		{"vllm", "vLLM", "selfhost", constant.ChannelTypeVLLM, "", "", "Optional bearer key; explicit URL and model ID required", []string{"name", "base_url", "upstream_model"}, "https://docs.vllm.ai/"},
		{"sglang", "SGLang", "selfhost", constant.ChannelTypeSGLang, "", "", "Optional bearer key; explicit URL and model ID required", []string{"name", "base_url", "upstream_model"}, "https://docs.sglang.ai/"},
		{"xinference", "Xinference", "selfhost", constant.ChannelTypeXinference, "", "", "Optional bearer key; explicit URL and model ID required", []string{"name", "base_url", "upstream_model"}, "https://inference.readthedocs.io/"},
		{"compatible", "自定义兼容接口", "platform", constant.ChannelTypeOpenAI, "", "", "API Key; explicit public HTTPS endpoint and model ID required", key, "https://platform.openai.com/docs/api-reference/chat"},
	}
	return rows
}
func appendFields(fields []string, more string) []string {
	out := append([]string{}, fields...)
	return append(out, more)
}
func managedProvider(name string) (modelProvider, bool) {
	for _, p := range managedModelCatalog() {
		if p.Provider == name {
			return p, true
		}
	}
	return modelProvider{}, false
}
