// formatter.go
// 
// Purpose: Ingests raw multidimensional API pricing JSON, normalizes currency, 
// calculates relative pricing percentiles, and compiles a strict $O(1)$ routing table 
// with endpoint resolution for NanoGPT's fragmented API structure.

package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sort"
	"strconv"
	"strings"
)

type MetaBlock struct {
	SchemaVersion        string      `json:"schema_version"`
	ArchitecturalMandate string      `json:"architectural_mandate"`
}

type OutputSchema struct {
	Meta           MetaBlock                           `json:"_meta"`
	DefaultRouting string                              `json:"default_routing"`
	Endpoints      map[string]string                   `json:"_endpoints"`    // Modality to API Path resolution
	IndexMatrix    map[string]map[string][]string      `json:"_index_matrix"` 
	RoutingTable   map[string]map[string]interface{}   `json:"routing_table"`
}

// Sanitizes ZAR/USD strings into raw float64
func parseCurrency(val string) float64 {
	clean := strings.ReplaceAll(val, "R", "")
	clean = strings.ReplaceAll(clean, "$", "")
	clean = strings.ReplaceAll(clean, "\u00a0", "")
	clean = strings.ReplaceAll(clean, " ", "")
	clean = strings.ReplaceAll(clean, ",", ".")
	
	if clean == "—" || clean == "" {
		return 0.0
	}
	f, err := strconv.ParseFloat(clean, 64)
	if err != nil {
		return 0.0
	}
	return f
}

// Determines tier based on relative dataset percentile
func calculateTier(cost float64, sortedCosts []float64) string {
	if len(sortedCosts) == 0 { return "Unknown" }
	idx := sort.SearchFloat64s(sortedCosts, cost)
	percentile := float64(idx) / float64(len(sortedCosts))

	if cost == 0.0 || percentile <= 0.25 { return "Basically Free" }
	if percentile <= 0.50 { return "Cheap" }
	if percentile <= 0.75 { return "Fair" }
	return "Extreme"
}

// Extracts provider from 'provider/model-name'
func extractProvider(apiName string) string {
	parts := strings.Split(apiName, "/")
	if len(parts) > 1 {
		return strings.Title(parts[0])
	}
	return "Independent"
}

func main() {
	file, err := os.Open("llmtemp.json")
	if err != nil {
		fmt.Printf("Critical: Failed to bind to llmtemp.json. %v\n", err)
		os.Exit(1)
	}
	defer file.Close()

	bytes, _ := io.ReadAll(file)
	var rawData map[string][]map[string]interface{}
	json.Unmarshal(bytes, &rawData)

	out := OutputSchema{
		Meta: MetaBlock{
			SchemaVersion:        "v9.1.0-multimodal-matrix",
			ArchitecturalMandate: "O(1) dictionary routing. Normalized cost tiers. Modality-based endpoint resolution.",
		},
		DefaultRouting: "deepseek-r1",
		// Injecting the API documentation mappings you provided
		Endpoints: map[string]string{
			"text":      "/api/v1/chat/completions",
			"image":     "/api/generate-image",
			"video":     "/api/generate-video", // Note: Requires client-side async polling on /api/generate-video/status
			"audio":     "/api/text-to-speech",
			"embedding": "/api/v1/embeddings",  // Standard fallback
		},
		IndexMatrix:  make(map[string]map[string][]string),
		RoutingTable: make(map[string]map[string]interface{}),
	}

	for targetModality, records := range rawData {
		modalityName := strings.Replace(targetModality, "_models", "", 1)
		out.IndexMatrix[modalityName] = make(map[string][]string)

		var costPool []float64
		for _, rec := range records {
			var cost float64
			if inRate, ok := rec["input_rate_1m_tokens"].(string); ok {
				outRate, _ := rec["output_rate_1m_tokens"].(string)
				cost = parseCurrency(inRate) + parseCurrency(outRate)
			} else if imgCost, ok := rec["cost_per_image"].(string); ok {
				cost = parseCurrency(imgCost)
			} else if vidCost, ok := rec["starting_at"].(string); ok {
				cost = parseCurrency(vidCost)
			} else if audCost, ok := rec["cost"].(string); ok {
				cost = parseCurrency(audCost)
			} else if embCost, ok := rec["cost_1m_tokens"].(string); ok {
				cost = parseCurrency(embCost)
			}
			costPool = append(costPool, cost)
		}
		sort.Float64s(costPool)

		for _, rec := range records {
			apiName, ok := rec["api_name"].(string)
			if !ok { continue }

			modelName, _ := rec["model_name"].(string)
			provider := extractProvider(apiName)

			out.IndexMatrix[modalityName][provider] = append(out.IndexMatrix[modalityName][provider], apiName)

			compiledRecord := map[string]interface{}{
				"label":    modelName,
				"provider": provider,
				"modality": modalityName,
			}

			var rawCost float64
			if inRate, ok := rec["input_rate_1m_tokens"].(string); ok {
				outRate, _ := rec["output_rate_1m_tokens"].(string)
				rawCost = parseCurrency(inRate) + parseCurrency(outRate)
				compiledRecord["max_input"] = rec["max_input"]
			} else if imgCost, ok := rec["cost_per_image"].(string); ok {
				rawCost = parseCurrency(imgCost)
				compiledRecord["resolution"] = rec["resolution"]
			} else if vidCost, ok := rec["starting_at"].(string); ok {
				rawCost = parseCurrency(vidCost)
			} else if audCost, ok := rec["cost"].(string); ok {
				rawCost = parseCurrency(audCost)
				compiledRecord["max_chars"] = rec["max_chars"]
			} else if embCost, ok := rec["cost_1m_tokens"].(string); ok {
				rawCost = parseCurrency(embCost)
				compiledRecord["dimensions"] = rec["dimensions"]
				compiledRecord["max_tokens"] = rec["max_tokens"]
			}
			
			compiledRecord["cost_tier"] = calculateTier(rawCost, costPool)
			
			if sub, ok := rec["subscription"].(string); ok {
				compiledRecord["requires_subscription"] = (sub == "Yes")
			}

			out.RoutingTable[apiName] = compiledRecord
		}
	}

	outputBytes, _ := json.MarshalIndent(out, "", "  ")
	err = os.WriteFile("llm-gen.json", outputBytes, 0644)
	if err != nil {
		fmt.Printf("Critical: File system lock prevented writing. %v\n", err)
		os.Exit(1)
	}

	fmt.Println("Compilation successful. llm-gen.json generated with Endpoint Resolution.")
}