import tkinter as tk
import mss
import cv2
import numpy as np
import threading
import time
import random

class AreaSelector:
    """
    第一步：全屏截图选区工具
    功能：让用户通过鼠标拖拽框选游戏区域，返回区域坐标
    """
    def __init__(self):
        self.root = tk.Tk()
        self.root.attributes("-fullscreen", True) # 全屏
        self.root.attributes("-alpha", 0.3)       # 设置透明度，让屏幕变暗以便框选
        self.root.configure(bg="black")
        self.root.configure(cursor="cross")       # 鼠标变成十字

        # 变量存储
        self.start_x = None
        self.start_y = None
        self.current_rect = None
        self.selected_region = None # 最终结果 {'top':, 'left':, 'width':, 'height':}

        # 画布
        self.canvas = tk.Canvas(self.root, bg="black", highlightthickness=0)
        self.canvas.pack(fill="both", expand=True)

        # 绑定鼠标事件
        self.canvas.bind("<ButtonPress-1>", self.on_button_press)
        self.canvas.bind("<B1-Motion>", self.on_move_press)
        self.canvas.bind("<ButtonRelease-1>", self.on_button_release)
        
        # 按 ESC 退出
        self.root.bind("<Escape>", lambda e: self.root.destroy())

        print(">>> 请在屏幕上框选【蜘蛛纸牌】的游戏区域...")

    def on_button_press(self, event):
        self.start_x = event.x
        self.start_y = event.y
        # 创建一个初始矩形（白色边框，红色填充提示）
        self.current_rect = self.canvas.create_rectangle(
            self.start_x, self.start_y, self.start_x, self.start_y, 
            outline="red", width=3, fill="white", stipple="gray12"
        )

    def on_move_press(self, event):
        cur_x, cur_y = (event.x, event.y)
        # 更新矩形大小
        self.canvas.coords(self.current_rect, self.start_x, self.start_y, cur_x, cur_y)

    def on_button_release(self, event):
        end_x, end_y = (event.x, event.y)
        
        # 计算左上角和宽高 (处理反向拖拽的情况)
        left = min(self.start_x, end_x)
        top = min(self.start_y, end_y)
        width = abs(end_x - self.start_x)
        height = abs(end_y - self.start_y)

        # 保存结果用于 mss
        self.selected_region = {"top": top, "left": left, "width": width, "height": height}
        
        print(f"区域已锁定: {self.selected_region}")
        self.root.destroy() # 关闭选区窗口，进入主程序

    def get_selection(self):
        self.root.mainloop()
        return self.selected_region

# ----------------------------------------------------------------

class SpiderSolitaireAssistant:
    """
    第二步：悬浮助手
    功能：基于传入的 region 进行实时监控和建议
    """
    def __init__(self, region):
        self.region = region # 接收框选的区域
        self.monitor_thread_running = True
        self.current_advice = "初始化监控中..."
        
        # 预计算10列的X坐标 (根据你框选的 width 动态计算)
        # 假设10列均匀分布
        self.col_width = region['width'] // 10
        
        self.setup_ui()
        self.start_monitoring()

    def setup_ui(self):
        self.root = tk.Tk()
        self.root.title("AI助手")
        
        # 窗口位置：放置在游戏区域的上方正中间
        win_w = 600
        win_h = 80
        pos_x = self.region['left'] + (self.region['width'] // 2) - (win_w // 2)
        pos_y = self.region['top'] - win_h - 10 # 放在顶部上方10像素处
        
        self.root.geometry(f"{win_w}x{win_h}+{int(pos_x)}+{int(pos_y)}")
        self.root.overrideredirect(True)       # 无边框
        self.root.attributes("-topmost", True) # 置顶
        self.root.configure(bg="black")
        self.root.attributes("-transparentcolor", "black") # 黑色变透明

        # 显示文字的标签
        self.label = tk.Label(self.root, 
                              text=self.current_advice, 
                              font=("Microsoft YaHei", 18, "bold"), 
                              fg="#00FF00", bg="black")
        self.label.pack(expand=True, fill="both")

        # 允许拖拽小条
        self.label.bind("<Button-1>", self.start_drag)
        self.label.bind("<B1-Motion>", self.do_drag)
        
        # 双击退出
        self.label.bind("<Double-Button-1>", lambda e: self.root.destroy())

    def start_drag(self, event):
        self.x = event.x
        self.y = event.y

    def do_drag(self, event):
        deltax = event.x - self.x
        deltay = event.y - self.y
        x = self.root.winfo_x() + deltax
        y = self.root.winfo_y() + deltay
        self.root.geometry(f"+{x}+{y}")

    def update_ui_text(self):
        self.label.config(text=self.current_advice)
        if self.monitor_thread_running:
            self.root.after(200, self.update_ui_text)

    def start_monitoring(self):
        # 启动后台识别线程
        thread = threading.Thread(target=self.background_process)
        thread.daemon = True
        thread.start()
        self.update_ui_text() # 启动UI刷新循环
        self.root.mainloop()

    def background_process(self):
        """这里运行 mss 截图和识别逻辑"""
        print("后台监控启动...")
        
        with mss.mss() as sct:
            while self.monitor_thread_running:
                try:
                    # 1. 截图 (只截取框选区域)
                    screenshot = sct.grab(self.region)
                    img = np.array(screenshot)
                    gray = cv2.cvtColor(img, cv2.COLOR_BGRA2GRAY)
                    
                    # 2. 切割列 (这里做个简单的演示切割)
                    # 你可以在这里加入 matchTemplate 逻辑
                    # for i in range(10):
                    #     col_img = gray[:, i*self.col_width : (i+1)*self.col_width]
                    #     result = your_recognition_function(col_img)
                    
                    # --- 模拟策略输出 (替换为你的真实算法) ---
                    # 这里为了演示，随机产生一些建议
                    time.sleep(2) 
                    strategies = [
                        f"建议: 将 第{random.randint(1,5)}列 移到 第{random.randint(6,10)}列",
                        "建议: 优先消除红色花色",
                        "检测到空列，尝试移动 K",
                        "正在扫描牌面..."
                    ]
                    self.current_advice = random.choice(strategies)
                    
                except Exception as e:
                    print(f"Error: {e}")
                    time.sleep(1)

# ----------------------------------------------------------------
# 主程序入口
# ----------------------------------------------------------------
if __name__ == "__main__":
    # 1. 先运行选区工具
    selector = AreaSelector()
    region = selector.get_selection()

    # 2. 如果用户成功框选了区域，则启动助手
    if region and region['width'] > 0 and region['height'] > 0:
        print(f"启动助手，监控区域: {region}")
        app = SpiderSolitaireAssistant(region)
    else:
        print("未选择区域或取消操作。")