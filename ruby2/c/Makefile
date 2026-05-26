CC ?= cc
CXX ?= c++
OBJC ?= cc
CFLAGS ?= -std=c99 -Wall -Wextra -Werror -pedantic -O2
CPPFLAGS ?= -Iinclude
THREAD_FLAGS ?= -pthread
UNAME_S := $(shell uname -s)
LLAMA_CPP_CANDIDATES ?= ../llama.cpp ../../llama.cpp $(HOME)/develop/voicebox/deps/llama.cpp /opt/homebrew/opt/llama.cpp
LLAMA_CPP_DIR ?= $(firstword $(foreach candidate,$(LLAMA_CPP_CANDIDATES),$(if $(wildcard $(candidate)/include/llama.h),$(candidate))))
SDL2_CONFIG ?= sdl2-config
SDL2_CFLAGS ?= $(shell $(SDL2_CONFIG) --cflags 2>/dev/null)
SDL2_LIBS ?= $(shell $(SDL2_CONFIG) --libs 2>/dev/null) -lSDL2_test
ifeq ($(strip $(LLAMA_CPP_DIR)),)
LLAMA_CPP_CPPFLAGS :=
LLAMA_CPP_LDFLAGS :=
LLAMA_CPP_LIBS :=
LLAMA_CPP_CFLAGS :=
LINK := $(CC)
else
LLAMA_CPP_CPPFLAGS := -DRUBY2_WITH_LLAMA_CPP -I$(LLAMA_CPP_DIR)/include -I$(LLAMA_CPP_DIR)/ggml/include
LLAMA_CPP_LDFLAGS := -L$(LLAMA_CPP_DIR)/build/bin -Wl,-rpath,$(abspath $(LLAMA_CPP_DIR))/build/bin
LLAMA_CPP_LIBS := -lllama
LLAMA_CPP_CFLAGS := -std=c11
LINK := $(CXX)
endif
BUILD_FLAVOR := $(if $(strip $(LLAMA_CPP_DIR)),llama,stub)
BUILD_DIR := build/$(BUILD_FLAVOR)
BIN_DIR := bin/$(BUILD_FLAVOR)
RUBY2_NATIVE_AI_BACKEND ?= llama.cpp
RUBY2_NATIVE_AI_MODEL ?= ruby-high-local
RUBY2_NATIVE_LLAMA_MODEL ?= $(abspath ../models/google_gemma-4-E4B-it-Q4_K_M.gguf)
RUBY2_NATIVE_AI_TIMEOUT_SECONDS ?= 6

ENGINE_SRC := src/ruby2_engine.c
WORLD_SRC := src/ruby2_world.c
WORLD_PERFORMANCE_SRC := src/ruby2_world_performance.c
RANKER_SRC := src/ruby2_ranker.c
UI_SRC := src/ruby2_ui.c
LLM_SRC := src/ruby2_llm.c
LLM_HTTP_SRC := src/ruby2_llm_http.c
LLAMA_CPP_SRC := src/ruby2_llama_cpp.c
LLM_OBJS := $(BUILD_DIR)/ruby2_llm.o $(BUILD_DIR)/ruby2_llm_http.o $(BUILD_DIR)/ruby2_llama_cpp.o
WEEK_ONE_SRC := src/week_one.c
PLAY_WEEK_ONE_SRC := src/play_week_one.c
VERTICAL_SLICE_SRC := src/vertical_slice.c
WORLD_SLICE_SRC := src/world_slice.c
UI_SNAPSHOT_SRC := src/ui_snapshot.c
TEST_SRC := tests/test_engine.c
WORLD_TEST_SRC := tests/test_world.c
GAMEPLAY_TEST_SRC := tests/test_gameplay.c
LLM_TEST_SRC := tests/test_llm.c
RANKER_TEST_SRC := tests/test_ranker.c
UI_TEST_SRC := tests/test_ui.c
NATIVE_APP_SRC := src/native_app.c
NATIVE_RENDERER_SRC := src/native_renderer.c
ifeq ($(UNAME_S),Darwin)
NATIVE_TEXT_SRC := src/native_text_macos.m
NATIVE_TEXT_LIBS := -framework AppKit
else
NATIVE_TEXT_SRC := src/native_text_stub.c
NATIVE_TEXT_LIBS :=
endif

.PHONY: all test run play play-llm play-world ui-snapshot native-app native-run native-run-ai native-frame native-smoke native-assets native-macos-app native-open gameplay-test world-test llm-test ranker-test ui-test clean

all: $(BIN_DIR)/ruby2_week_one $(BIN_DIR)/ruby2_play_week_one $(BIN_DIR)/ruby2_vertical_slice $(BIN_DIR)/ruby2_world_slice $(BIN_DIR)/ruby2_ui_snapshot $(BIN_DIR)/ruby2_tests $(BIN_DIR)/ruby2_world_tests $(BIN_DIR)/ruby2_gameplay_tests $(BIN_DIR)/ruby2_llm_tests $(BIN_DIR)/ruby2_ranker_tests $(BIN_DIR)/ruby2_ui_tests

$(BUILD_DIR) $(BIN_DIR):
	mkdir -p $@

$(BUILD_DIR)/ruby2_engine.o: $(ENGINE_SRC) include/ruby2_engine.h | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) -c $(ENGINE_SRC) -o $@

$(BUILD_DIR)/ruby2_world.o: $(WORLD_SRC) include/ruby2_world.h include/ruby2_ranker.h include/ruby2_engine.h | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) -c $(WORLD_SRC) -o $@

$(BUILD_DIR)/ruby2_world_performance.o: $(WORLD_PERFORMANCE_SRC) include/ruby2_world_performance.h include/ruby2_world.h include/ruby2_llm.h include/ruby2_engine.h | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) -c $(WORLD_PERFORMANCE_SRC) -o $@

$(BUILD_DIR)/ruby2_ranker.o: $(RANKER_SRC) include/ruby2_ranker.h include/ruby2_world.h include/ruby2_engine.h | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) -c $(RANKER_SRC) -o $@

$(BUILD_DIR)/ruby2_ui.o: $(UI_SRC) include/ruby2_ui.h include/ruby2_ranker.h include/ruby2_world.h include/ruby2_world_performance.h include/ruby2_engine.h | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) -c $(UI_SRC) -o $@

$(BUILD_DIR)/ruby2_llm.o: $(LLM_SRC) include/ruby2_llm.h include/ruby2_engine.h | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) -c $(LLM_SRC) -o $@

$(BUILD_DIR)/ruby2_llm_http.o: $(LLM_HTTP_SRC) include/ruby2_llm_http.h include/ruby2_llm.h include/ruby2_engine.h | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) -c $(LLM_HTTP_SRC) -o $@

$(BUILD_DIR)/ruby2_llama_cpp.o: $(LLAMA_CPP_SRC) include/ruby2_llama_cpp.h include/ruby2_llm.h include/ruby2_engine.h | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(LLAMA_CPP_CPPFLAGS) $(CFLAGS) $(LLAMA_CPP_CFLAGS) -c $(LLAMA_CPP_SRC) -o $@

$(BUILD_DIR)/week_one.o: $(WEEK_ONE_SRC) include/ruby2_engine.h | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) -c $(WEEK_ONE_SRC) -o $@

$(BUILD_DIR)/play_week_one.o: $(PLAY_WEEK_ONE_SRC) include/ruby2_engine.h | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) -c $(PLAY_WEEK_ONE_SRC) -o $@

$(BUILD_DIR)/vertical_slice.o: $(VERTICAL_SLICE_SRC) include/ruby2_engine.h include/ruby2_llm.h | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) $(THREAD_FLAGS) -c $(VERTICAL_SLICE_SRC) -o $@

$(BUILD_DIR)/world_slice.o: $(WORLD_SLICE_SRC) include/ruby2_world.h include/ruby2_engine.h | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) -c $(WORLD_SLICE_SRC) -o $@

$(BUILD_DIR)/ui_snapshot.o: $(UI_SNAPSHOT_SRC) include/ruby2_ui.h include/ruby2_ranker.h include/ruby2_world.h include/ruby2_engine.h | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) -c $(UI_SNAPSHOT_SRC) -o $@

$(BUILD_DIR)/test_engine.o: $(TEST_SRC) include/ruby2_engine.h | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) -c $(TEST_SRC) -o $@

$(BUILD_DIR)/test_world.o: $(WORLD_TEST_SRC) include/ruby2_world.h include/ruby2_world_performance.h include/ruby2_engine.h | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) -c $(WORLD_TEST_SRC) -o $@

$(BUILD_DIR)/test_gameplay.o: $(GAMEPLAY_TEST_SRC) include/ruby2_engine.h | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) -c $(GAMEPLAY_TEST_SRC) -o $@

$(BUILD_DIR)/test_llm.o: $(LLM_TEST_SRC) include/ruby2_llm.h include/ruby2_engine.h | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) -c $(LLM_TEST_SRC) -o $@

$(BUILD_DIR)/test_ranker.o: $(RANKER_TEST_SRC) include/ruby2_ranker.h include/ruby2_world.h include/ruby2_engine.h | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) -c $(RANKER_TEST_SRC) -o $@

$(BUILD_DIR)/test_ui.o: $(UI_TEST_SRC) include/ruby2_ui.h include/ruby2_ranker.h include/ruby2_world.h include/ruby2_engine.h | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) -c $(UI_TEST_SRC) -o $@

$(BUILD_DIR)/native_app.o: $(NATIVE_APP_SRC) include/ruby2_native_renderer.h include/ruby2_llm.h include/ruby2_ui.h include/ruby2_ranker.h include/ruby2_world.h include/ruby2_world_performance.h include/ruby2_engine.h | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(SDL2_CFLAGS) $(CFLAGS) -c $(NATIVE_APP_SRC) -o $@

$(BUILD_DIR)/native_renderer.o: $(NATIVE_RENDERER_SRC) include/ruby2_native_renderer.h include/ruby2_native_text.h include/ruby2_ui.h include/ruby2_ranker.h include/ruby2_world.h include/ruby2_world_performance.h include/ruby2_engine.h | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(SDL2_CFLAGS) $(CFLAGS) -c $(NATIVE_RENDERER_SRC) -o $@

ifeq ($(UNAME_S),Darwin)
$(BUILD_DIR)/native_text.o: $(NATIVE_TEXT_SRC) include/ruby2_native_text.h | $(BUILD_DIR)
	$(OBJC) $(CPPFLAGS) $(SDL2_CFLAGS) -fobjc-arc -O2 -c $(NATIVE_TEXT_SRC) -o $@
else
$(BUILD_DIR)/native_text.o: $(NATIVE_TEXT_SRC) include/ruby2_native_text.h | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(SDL2_CFLAGS) $(CFLAGS) -c $(NATIVE_TEXT_SRC) -o $@
endif

$(BIN_DIR)/ruby2_week_one: $(BUILD_DIR)/ruby2_engine.o $(BUILD_DIR)/week_one.o | $(BIN_DIR)
	$(CC) $(CFLAGS) $^ -o $@

$(BIN_DIR)/ruby2_play_week_one: $(BUILD_DIR)/ruby2_engine.o $(BUILD_DIR)/play_week_one.o | $(BIN_DIR)
	$(CC) $(CFLAGS) $^ -o $@

$(BIN_DIR)/ruby2_vertical_slice: $(BUILD_DIR)/ruby2_engine.o $(LLM_OBJS) $(BUILD_DIR)/vertical_slice.o | $(BIN_DIR)
	$(LINK) $(CFLAGS) $^ $(LLAMA_CPP_LDFLAGS) $(LLAMA_CPP_LIBS) $(THREAD_FLAGS) -o $@

$(BIN_DIR)/ruby2_world_slice: $(BUILD_DIR)/ruby2_engine.o $(BUILD_DIR)/ruby2_world.o $(BUILD_DIR)/ruby2_ranker.o $(BUILD_DIR)/world_slice.o | $(BIN_DIR)
	$(CC) $(CFLAGS) $^ -o $@

$(BIN_DIR)/ruby2_ui_snapshot: $(BUILD_DIR)/ruby2_engine.o $(BUILD_DIR)/ruby2_world.o $(BUILD_DIR)/ruby2_world_performance.o $(BUILD_DIR)/ruby2_ranker.o $(BUILD_DIR)/ruby2_ui.o $(BUILD_DIR)/ui_snapshot.o | $(BIN_DIR)
	$(CC) $(CFLAGS) $^ -o $@

$(BIN_DIR)/ruby2_tests: $(BUILD_DIR)/ruby2_engine.o $(BUILD_DIR)/test_engine.o | $(BIN_DIR)
	$(CC) $(CFLAGS) $^ -o $@

$(BIN_DIR)/ruby2_world_tests: $(BUILD_DIR)/ruby2_engine.o $(BUILD_DIR)/ruby2_world.o $(BUILD_DIR)/ruby2_world_performance.o $(BUILD_DIR)/ruby2_ranker.o $(BUILD_DIR)/test_world.o | $(BIN_DIR)
	$(CC) $(CFLAGS) $^ -o $@

$(BIN_DIR)/ruby2_gameplay_tests: $(BUILD_DIR)/ruby2_engine.o $(BUILD_DIR)/test_gameplay.o | $(BIN_DIR)
	$(CC) $(CFLAGS) $^ -o $@

$(BIN_DIR)/ruby2_llm_tests: $(BUILD_DIR)/ruby2_engine.o $(LLM_OBJS) $(BUILD_DIR)/test_llm.o | $(BIN_DIR)
	$(LINK) $(CFLAGS) $^ $(LLAMA_CPP_LDFLAGS) $(LLAMA_CPP_LIBS) -o $@

$(BIN_DIR)/ruby2_ranker_tests: $(BUILD_DIR)/ruby2_engine.o $(BUILD_DIR)/ruby2_world.o $(BUILD_DIR)/ruby2_ranker.o $(BUILD_DIR)/test_ranker.o | $(BIN_DIR)
	$(CC) $(CFLAGS) $^ -o $@

$(BIN_DIR)/ruby2_ui_tests: $(BUILD_DIR)/ruby2_engine.o $(BUILD_DIR)/ruby2_world.o $(BUILD_DIR)/ruby2_world_performance.o $(BUILD_DIR)/ruby2_ranker.o $(BUILD_DIR)/ruby2_ui.o $(BUILD_DIR)/test_ui.o | $(BIN_DIR)
	$(CC) $(CFLAGS) $^ -o $@

$(BIN_DIR)/ruby2_native_app: $(BUILD_DIR)/ruby2_engine.o $(BUILD_DIR)/ruby2_world.o $(BUILD_DIR)/ruby2_world_performance.o $(BUILD_DIR)/ruby2_ranker.o $(BUILD_DIR)/ruby2_ui.o $(LLM_OBJS) $(BUILD_DIR)/native_app.o $(BUILD_DIR)/native_renderer.o $(BUILD_DIR)/native_text.o | $(BIN_DIR)
	$(LINK) $(CFLAGS) $^ $(SDL2_LIBS) $(NATIVE_TEXT_LIBS) $(LLAMA_CPP_LDFLAGS) $(LLAMA_CPP_LIBS) $(THREAD_FLAGS) -o $@

run: $(BIN_DIR)/ruby2_week_one
	$(BIN_DIR)/ruby2_week_one

play: $(BIN_DIR)/ruby2_play_week_one
	$(BIN_DIR)/ruby2_play_week_one

play-llm: $(BIN_DIR)/ruby2_vertical_slice
	$(BIN_DIR)/ruby2_vertical_slice

play-world: $(BIN_DIR)/ruby2_world_slice
	$(BIN_DIR)/ruby2_world_slice

ui-snapshot: $(BIN_DIR)/ruby2_ui_snapshot
	$(BIN_DIR)/ruby2_ui_snapshot

native-assets:
	python3 tools/prepare_native_assets.py

native-app: $(BIN_DIR)/ruby2_native_app

native-macos-app: native-assets $(BIN_DIR)/ruby2_native_app
	mkdir -p $(BIN_DIR)/RubyHighNative.app/Contents/MacOS
	mkdir -p $(BIN_DIR)/RubyHighNative.app/Contents/Resources
	cp $(BIN_DIR)/ruby2_native_app $(BIN_DIR)/RubyHighNative.app/Contents/MacOS/RubyHighNative
	rm -rf $(BIN_DIR)/RubyHighNative.app/Contents/Resources/native-assets
	cp -R native-assets $(BIN_DIR)/RubyHighNative.app/Contents/Resources/native-assets
	printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>' \
	  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' \
	  '<plist version="1.0">' \
	  '<dict>' \
	  '  <key>CFBundleExecutable</key>' \
	  '  <string>RubyHighNative</string>' \
	  '  <key>CFBundleIdentifier</key>' \
	  '  <string>chat.rati.ruby-high.native-slice</string>' \
	  '  <key>CFBundleName</key>' \
	  '  <string>Ruby High Native Slice</string>' \
	  '  <key>CFBundlePackageType</key>' \
	  '  <string>APPL</string>' \
	  '  <key>CFBundleVersion</key>' \
	  '  <string>0.1.0</string>' \
	  '  <key>CFBundleShortVersionString</key>' \
	  '  <string>0.1.0</string>' \
	  '  <key>LSMinimumSystemVersion</key>' \
	  '  <string>13.0</string>' \
	  '  <key>NSHighResolutionCapable</key>' \
	  '  <true/>' \
	  '</dict>' \
	  '</plist>' > $(BIN_DIR)/RubyHighNative.app/Contents/Info.plist
	codesign --force --deep --sign - $(BIN_DIR)/RubyHighNative.app

native-open: native-macos-app
	open \
	  --env RUBY2_LLM_BACKEND=$(RUBY2_NATIVE_AI_BACKEND) \
	  --env RUBY2_LLM_MODEL=$(RUBY2_NATIVE_AI_MODEL) \
	  --env RUBY2_LLAMA_MODEL=$(RUBY2_NATIVE_LLAMA_MODEL) \
	  --env RUBY2_LLM_TIMEOUT_SECONDS=$(RUBY2_NATIVE_AI_TIMEOUT_SECONDS) \
	  -n $(abspath $(BIN_DIR))/RubyHighNative.app

native-run: native-assets $(BIN_DIR)/ruby2_native_app
	$(BIN_DIR)/ruby2_native_app

native-run-ai: native-assets $(BIN_DIR)/ruby2_native_app
	RUBY2_LLM_BACKEND=$(RUBY2_NATIVE_AI_BACKEND) \
	RUBY2_LLM_MODEL=$(RUBY2_NATIVE_AI_MODEL) \
	RUBY2_LLAMA_MODEL=$(RUBY2_NATIVE_LLAMA_MODEL) \
	RUBY2_LLM_TIMEOUT_SECONDS=$(RUBY2_NATIVE_AI_TIMEOUT_SECONDS) \
	$(BIN_DIR)/ruby2_native_app

native-smoke: $(BIN_DIR)/ruby2_native_app
	$(BIN_DIR)/ruby2_native_app --smoke --demo homeroom_problem

native-frame: native-assets $(BIN_DIR)/ruby2_native_app
	$(BIN_DIR)/ruby2_native_app --demo homeroom_problem --show-board --write-bmp native-frame.bmp

test: $(BIN_DIR)/ruby2_tests $(BIN_DIR)/ruby2_world_tests $(BIN_DIR)/ruby2_gameplay_tests $(BIN_DIR)/ruby2_llm_tests $(BIN_DIR)/ruby2_ranker_tests $(BIN_DIR)/ruby2_ui_tests
	$(BIN_DIR)/ruby2_tests
	$(BIN_DIR)/ruby2_world_tests
	$(BIN_DIR)/ruby2_gameplay_tests
	$(BIN_DIR)/ruby2_llm_tests
	$(BIN_DIR)/ruby2_ranker_tests
	$(BIN_DIR)/ruby2_ui_tests

gameplay-test: $(BIN_DIR)/ruby2_gameplay_tests
	$(BIN_DIR)/ruby2_gameplay_tests

world-test: $(BIN_DIR)/ruby2_world_tests
	$(BIN_DIR)/ruby2_world_tests

llm-test: $(BIN_DIR)/ruby2_llm_tests
	$(BIN_DIR)/ruby2_llm_tests

ranker-test: $(BIN_DIR)/ruby2_ranker_tests
	$(BIN_DIR)/ruby2_ranker_tests

ui-test: $(BIN_DIR)/ruby2_ui_tests
	$(BIN_DIR)/ruby2_ui_tests

clean:
	rm -rf build bin
