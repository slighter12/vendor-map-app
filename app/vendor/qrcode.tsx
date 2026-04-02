import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as FileSystem from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { router } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  Text,
  View,
} from "react-native";
import ViewShot from "react-native-view-shot";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/contexts/AuthContext";
import { subscriptionsApi } from "@/services/api/subscriptions";

export default function VendorQrCodeScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const shotRef = useRef<any>(null);
  const [busy, setBusy] = useState<"none" | "image" | "pdf" | "print">("none");
  const [qrImageUri, setQrImageUri] = useState("");
  const [isQrLoading, setIsQrLoading] = useState(true);
  const [qrError, setQrError] = useState("");

  React.useEffect(() => {
    StatusBar.setBarStyle("light-content");
    if (Platform.OS === "android") {
      StatusBar.setBackgroundColor("transparent");
      StatusBar.setTranslucent(true);
    }
  }, []);

  const loadQrCode = useCallback(async () => {
    try {
      setIsQrLoading(true);
      setQrError("");

      const response = await subscriptionsApi.getMerchantQrCode();
      const qrBlob = await response.blob();

      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result;
          if (typeof result === "string" && result.length > 0) {
            resolve(result);
            return;
          }
          reject(new Error("無法讀取 QR 圖片資料"));
        };
        reader.onerror = () => reject(new Error("QR 圖片轉換失敗"));
        reader.readAsDataURL(qrBlob);
      });

      setQrImageUri(dataUrl);
    } catch (error: any) {
      setQrImageUri("");
      setQrError(error?.message || "載入 QR Code 失敗");
    } finally {
      setIsQrLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadQrCode();
  }, [loadQrCode]);

  const capturePng = async (): Promise<string> => {
    const uri = await shotRef.current?.capture?.({
      format: "png",
      quality: 1,
      result: "tmpfile",
    });
    if (!uri) throw new Error("無法匯出圖片，請稍後再試");
    return uri as string;
  };

  const buildPdfFromPng = async (pngUri: string) => {
    const base64 = await FileSystem.readAsStringAsync(pngUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const title = user?.name ? String(user.name) : "攤商";
    const html = `
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Helvetica", "Arial"; padding: 24px; }
            .card { border: 1px solid #e5e7eb; border-radius: 16px; padding: 20px; }
            .title { font-size: 20px; font-weight: 800; margin: 0 0 6px 0; }
            .sub { font-size: 12px; color: #6b7280; margin: 0 0 14px 0; }
            .qr { width: 320px; height: 320px; display: block; margin: 16px auto; }
            .hint { font-size: 12px; color: #111827; text-align: center; }
          </style>
        </head>
        <body>
          <div class="card">
            <p class="title">訂閱 QR Code</p>
            <p class="sub">請用客戶端掃描以訂閱通知</p>
            <img class="qr" src="data:image/png;base64,${base64}" />
            <p class="hint">${title}</p>
          </div>
        </body>
      </html>
    `;

    return Print.printToFileAsync({ html });
  };

  const onShareImage = async () => {
    if (!qrImageUri) {
      Alert.alert("無法分享", qrError || "目前尚未載入 QR Code");
      return;
    }
    try {
      setBusy("image");
      const uri = await capturePng();
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert("無法分享", "此裝置不支援分享功能");
        return;
      }
      await Sharing.shareAsync(uri, { mimeType: "image/png" });
    } catch (e: any) {
      Alert.alert("錯誤", e?.message || "匯出圖片失敗");
    } finally {
      setBusy("none");
    }
  };

  const onExportPdf = async () => {
    if (!qrImageUri) {
      Alert.alert("無法匯出", qrError || "目前尚未載入 QR Code");
      return;
    }
    try {
      setBusy("pdf");
      const pngUri = await capturePng();
      const pdf = await buildPdfFromPng(pngUri);
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert("無法分享", "此裝置不支援分享功能");
        return;
      }
      await Sharing.shareAsync(pdf.uri, {
        mimeType: "application/pdf",
        UTI: "com.adobe.pdf",
      });
    } catch (e: any) {
      Alert.alert("錯誤", e?.message || "匯出 PDF 失敗");
    } finally {
      setBusy("none");
    }
  };

  const onPrint = async () => {
    if (!qrImageUri) {
      Alert.alert("無法列印", qrError || "目前尚未載入 QR Code");
      return;
    }
    try {
      setBusy("print");
      const pngUri = await capturePng();
      const pdf = await buildPdfFromPng(pngUri);
      await Print.printAsync({ uri: pdf.uri });
    } catch (e: any) {
      Alert.alert("錯誤", e?.message || "列印失敗（可改用匯出 PDF）");
    } finally {
      setBusy("none");
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={["left", "right", "bottom"]}>
      <LinearGradient
        colors={["#FF6B6B", "#FF8E53"]}
        style={{
          paddingTop: insets.top + 12,
          paddingBottom: 18,
          paddingHorizontal: 16,
        }}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View className="flex-row items-center justify-between">
          <Pressable
            onPress={() => router.back()}
            className="w-10 h-10 rounded-2xl bg-white/20 items-center justify-center"
          >
            <Ionicons name="chevron-back" size={20} color="#fff" />
          </Pressable>
          <View className="flex-1 px-3">
            <Text className="text-lg font-extrabold text-white text-center">
              我的訂閱 QR Code
            </Text>
            <Text className="text-xs text-white/85 mt-0.5 text-center">
              讓客戶掃描即可訂閱通知
            </Text>
          </View>
          <View className="w-10 h-10" />
        </View>
      </LinearGradient>

      <ScrollView
        className="flex-1 px-5"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 120, gap: 14 }}
      >
        <View className="bg-white border border-gray-200 rounded-3xl p-4">
          <View className="flex-row items-center gap-2">
            <View className="w-9 h-9 rounded-xl bg-gray-100 items-center justify-center">
              <Ionicons name="qr-code" size={18} color="#6b7280" />
            </View>
            <View className="flex-1">
              <Text className="text-base font-bold text-gray-900">掃描訂閱</Text>
              <Text className="text-xs text-gray-500 mt-0.5">
                客戶端掃描此 QR，即可訂閱你的通知
              </Text>
            </View>
          </View>

          <View className="mt-4 items-center">
            <ViewShot
              ref={shotRef}
              options={{ format: "png", quality: 1, result: "tmpfile" }}
              style={{ width: "100%", alignItems: "center" }}
            >
              <View className="bg-white border border-gray-200 rounded-3xl p-5">
                <View className="items-center">
                  <View className="bg-white p-3 rounded-2xl border border-gray-200">
                    {isQrLoading ? (
                      <View className="w-[260px] h-[260px] items-center justify-center gap-3">
                        <ActivityIndicator size="large" color="#6b7280" />
                        <Text className="text-sm text-gray-600">載入 QR Code 中...</Text>
                      </View>
                    ) : qrImageUri ? (
                      <Image
                        source={{ uri: qrImageUri }}
                        style={{ width: 260, height: 260 }}
                        resizeMode="contain"
                      />
                    ) : qrError ? (
                      <View className="w-[260px] h-[260px] items-center justify-center px-4">
                        <Ionicons name="alert-circle-outline" size={28} color="#DC2626" />
                        <Text className="mt-3 text-center text-sm text-gray-700">
                          {qrError}
                        </Text>
                        <Pressable
                          onPress={() => void loadQrCode()}
                          className="mt-4 rounded-xl bg-gray-900 px-4 py-2"
                        >
                          <Text className="font-semibold text-white">重新載入</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <View className="w-[260px] h-[260px] items-center justify-center">
                        <Text className="text-sm text-gray-600">尚未取得 QR Code</Text>
                      </View>
                    )}
                  </View>

                  <Text className="mt-4 text-xs text-gray-500">
                    此 QR Code 由系統依目前登入的攤商帳號產生
                  </Text>
                </View>
              </View>
            </ViewShot>
          </View>

          <View className="flex-row gap-3 mt-5">
            <Pressable
              onPress={onShareImage}
              disabled={busy !== "none"}
              className={`flex-1 rounded-2xl py-3 items-center ${
                busy !== "none" ? "bg-gray-300" : "bg-gray-900"
              }`}
            >
              {busy === "image" ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-white font-semibold">分享圖片</Text>
              )}
            </Pressable>
            <Pressable
              onPress={onExportPdf}
              disabled={busy !== "none"}
              className={`flex-1 rounded-2xl py-3 items-center ${
                busy !== "none" ? "bg-gray-300" : "bg-blue-600"
              }`}
            >
              {busy === "pdf" ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-white font-semibold">匯出 PDF</Text>
              )}
            </Pressable>
          </View>

          <Pressable
            onPress={onPrint}
            disabled={busy !== "none"}
            className={`mt-3 rounded-2xl py-3 items-center ${
              busy !== "none" ? "bg-gray-300" : "bg-amber-500"
            }`}
          >
            {busy === "print" ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-white font-semibold">列印</Text>
            )}
          </Pressable>
        </View>

        <View className="bg-white border border-gray-200 rounded-3xl p-4">
          <View className="flex-row items-start gap-2">
            <Ionicons name="information-circle" size={18} color="#6b7280" />
            <Text className="text-sm text-gray-700 flex-1 leading-6">
              建議將「匯出 PDF」的檔案分享給列印 App 或 AirPrint 進行列印，
              並張貼在攤位旁讓顧客掃碼訂閱。
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
