# Проєкти 2022–2025 з диска Data320 (pc2: /run/media/unix256/Data320/Projetcs/)

Знайдено за `List.txt`. Роки за датами файлів. Усе нижче [підтвердити] власником (замовники, ролі, результати).

| Проєкт | Роки файлів | Що це (за вмістом) | Матеріали |
|---|---|---|---|
| **Prometheus / Coffee_machine** | 2022–2023 | Плата керування на STM32G070 (KiCad) для кавового обладнання: ModBus RTU, RS-485 (ізол.), 7 аналог. виходів 0–10 В, входи термопар К-типу (MAX6675) і 4–20 мА, 10 дискретних входів/виходів, DIN-рейка, живлення 15–28 В; ТЗ за договором від 17.11.2022 (договір і номери не публікувати). Є фото готової плати «PROMETHEUS» (2023-03) | `coffee/instr/photo_…14-09-31.jpg`, `…14-52-17.jpg`, KiCad у `Coffee_machine/CoffeeBoardPCB` |
| **Signal1** (модулі 380/382) | 2022–2023 | Прошивка двох плат (STM32) з меню, Modbus (архів, регістри, тривоги, календар), діаграма станів, тестові скріни Modbus-інструмента | `signal/StateDiagram.jpg`, `TeastArhive.jpg`, `TestSecure.jpg`; ТЗ, діаграми, чекліст |
| **ESPCAN / ChargeBridge** | 2023–2026 | Міст зарядки EV на ESP32/ESP32-S3: протокол GB/T 27930-2015 (CAN), у `PC/GBT2015_Debug` (C++/MSVC) налагоджувач; документація Sinnexel 40 кВт; плата Altium `ChargeBridgeV1.03` (CAN1/CAN2, CC1), модулі WHITE-BEET (CCS/PLC), «Counter» (V1.6–V2.5, ESP32 Contactor) | `charger/*.jpg` (3D плати), `counter/3d_top.jpg` |
| **CanHelper / CAN_Command** | 2022 | C#-програма для CAN-пакетів («CanHelper TSK») і пристрій ON/OFF «TSK Kyiv» | `tools2022/CanHelper.jpg`, `CAN_Command.jpg`, `DMM_LCD.jpg` |
| **ToyotaApp** (Qt6, OrangePi Zero 2W) | 2025 | Графічний монітор CAN-даних Toyota Prius: HV-батарея, напруги модулів, швидкість/температура, симуляція логів; запускається на Linux/Qt6 | є лише логотипи; **скрінів програми немає: треба запустити** |
| **IRO_BTT** | 2021–2025 | Плата/прошивка на STM32G0B1 (BTT SKR mini E3) | потребує фото/скрінів |
| **FontCreator C# / ButtonAndFontCreator** | 2015–2022 | C#-утиліти для LCD (Image2LCD, шрифти) | WinForms: потрібен Windows для скрінів |
| **LANControlQt6 / LANControlSlint** | 2025–2026 | Власні застосунки (Qt6, Rust/Slint) | є живі, можна знімати скріни |
| **SolarTreker** | 2023, 2025 | MCU-проєкт + Blender-марки | уточнити |

## Що можна зробити без Windows (Linux на pc2 і Main)
- ToyotaApp: зібрати/запустити з симуляцією `_logs/canLog.txt`, зняти скріни (є CMake, Qt6).
- LANControlQt6 і LANControlSlint: уже збудовані (`build*`), зняти скріни.
- PCB-рендери з Altium-експортів уже є (`charger/`, `counter/`).

## Потрібен Windows (pc2 перезавантажити у Windows або Main/ Windows-розділ)
- `PC/GBT2015_Debug` (Visual Studio .sln), C# WinForms (FontCreator, Image2LCD), WPF/WinForms-утиліти для ModBus/CAN.


## Уточнення власника (2026-11-04)
- **CanHelper**: Windows, C# WPF, інструмент для роботи з CAN в авто Tesla та інших авто (OBD); вихідників на Data320/Data436 не знайдено, лише скрін. **FontCreator**: C# (Windows). Скрінів для них потрібен Windows (pc2 у Windows).
- **LANControlQt6**: C++/Qt6 для Windows (є .exe і збірки); **LANControlSlint**: Rust + Slint (Windows-збірка `x86_64-pc-windows-msvc`). Це застосунки під Windows, у Linux на pc2 їх повний запуск не підтверджено; для скрінів UI можна рендерити `.slint`-екрани (`ui/*.slint`, slint-viewer) або запустити на Windows. Наявні `deploy/master-*.jpg` на pc2 це знімки екрана ПК з чужими вікнами, їх не використовувати.
- **ChargeBridge**: лише PCB (Altium). Код без інтерфейсу, тому показувати плати й адаптери (YELLOW/WHITE-BEET shield, Counter V2.x) на 3D-рендерах: `counter/*.jpg`, `charger/*.jpg`.
- **ToyotaApp**: зібрано на pc2 (Qt6, offscreen) із симуляцією логу CAN; скріни в `toyota/toyota-app-1.jpg`, `toyota-app-3.jpg`.
- **Смарт-годинник на LVGL**: фото (у пакеті немає, власник підставить; потребують обрізання) у `lvgl-watch/` (головний екран з іконками, список «German files», календар), знято 2026-05 (на екрані дата 2026-05-14), узято з файлового диска Fedora.
