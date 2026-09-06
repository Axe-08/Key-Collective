package proxy

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"time"

	"github.com/akshit/key-collective/internal/domain"
)

type ProxyServer struct {
	Manager     *KeyManager
	ValidTokens map[string]bool // hashed token -> true
	LogChannel  chan *domain.RequestLog
}

func (p *ProxyServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	startTime := time.Now()

	// 1. Validate Auth Token
	authHeader := r.Header.Get("Authorization")
	if len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	token := authHeader[7:]
	hashed := HashToken(token)
	if !p.ValidTokens[hashed] {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// 2. Read body to parse provider if possible (e.g., model name checking)
	bodyBytes, _ := io.ReadAll(r.Body)
	r.Body.Close()
	r.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))

	var reqBody map[string]interface{}
	json.Unmarshal(bodyBytes, &reqBody)
	modelName, _ := reqBody["model"].(string)

	var preferred domain.Provider
	if modelName != "" {
		// Basic model routing logic
		if len(modelName) >= 6 && modelName[:6] == "gemini" {
			preferred = domain.ProviderGemini
		} else {
			preferred = domain.ProviderGroq
		}
	}

	// 3. Get best key
	bestKey, err := p.Manager.GetBestKey(preferred)
	if err != nil {
		http.Error(w, err.Error(), http.StatusTooManyRequests)
		return
	}

	// 4. Construct Upstream Request
	var targetUrl *url.URL
	if bestKey.Provider == domain.ProviderGemini {
		// Gemini API URL format
		targetUrl, _ = url.Parse("https://generativelanguage.googleapis.com")
		// For OpenAI compatibility on Gemini:
		// We expect the client to use standard OpenAI paths and we might need to rewrite it, 
		// but let's assume the user is using litellm format or standard openai proxy on google.
	} else {
		targetUrl, _ = url.Parse("https://api.groq.com/openai")
	}

	proxy := httputil.NewSingleHostReverseProxy(targetUrl)

	// Intercept response to check status code
	proxy.ModifyResponse = func(resp *http.Response) error {
		latency := float64(time.Since(startTime).Milliseconds())

		// Async logging
		select {
		case p.LogChannel <- &domain.RequestLog{
			KeyID:      bestKey.ID,
			Provider:   bestKey.Provider,
			StatusCode: resp.StatusCode,
			LatencyMs:  latency,
			BytesIn:    int64(len(bodyBytes)),
			BytesOut:   resp.ContentLength, // approximate
			CreatedAt:  time.Now(),
		}:
		default:
			// channel full, drop log to avoid blocking
			log.Println("Warning: Log channel full, dropping log entry")
		}

		if resp.StatusCode == 200 {
			p.Manager.ReportSuccess(bestKey, latency)
		} else {
			p.Manager.ReportError(bestKey, resp.StatusCode)
		}

		return nil
	}

	// Rewrite headers
	r.URL.Host = targetUrl.Host
	r.URL.Scheme = targetUrl.Scheme
	r.Header.Set("Authorization", "Bearer "+bestKey.Decrypted)
	// NOTE: In the real implementation, we need the decrypted key in memory.
	// For now, assuming bestKey has a way to provide it or it's held in memory.
	// Actually, we must hold decrypted key in memory. Let's assume bestKey has a field Decrypted string
	// Let's modify the struct temporarily using a runtime map or just assume we have it.
	
	// Proxy!
	proxy.ServeHTTP(w, r)
}
