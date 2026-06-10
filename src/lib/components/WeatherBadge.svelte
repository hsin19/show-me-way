<script lang="ts">
import {
    Cloud,
    CloudDrizzle,
    CloudFog,
    CloudLightning,
    CloudRain,
    CloudSnow,
    CloudSun,
    Droplets,
    Sun,
} from "@lucide/svelte";
import {
    type DailyWeather,
    weatherCodeInfo,
    type WeatherIconKind,
} from "../weather";

interface Props {
    weather: DailyWeather;
}

let { weather }: Props = $props();

const ICONS: Record<WeatherIconKind, typeof Sun> = {
    "sun": Sun,
    "cloud-sun": CloudSun,
    "cloud": Cloud,
    "fog": CloudFog,
    "drizzle": CloudDrizzle,
    "rain": CloudRain,
    "snow": CloudSnow,
    "thunder": CloudLightning,
};

const info = $derived(weatherCodeInfo(weather.code));
const WeatherIcon = $derived(ICONS[info.icon]);
</script>

<!-- Label is visible text (not a title tooltip): this app lives on phones, where hover doesn't exist. -->
<div class="flex items-center gap-1.5 text-xs text-text-secondary">
    <WeatherIcon size={14} class="shrink-0" aria-hidden="true" />
    <span>{info.label} {Math.round(weather.tempMin)}° / {Math.round(weather.tempMax)}°</span>
    {#if weather.precipProb !== null && weather.precipProb >= 20}
        <span class="flex items-center gap-0.5 text-neon-blue/80">
            <Droplets size={11} class="shrink-0" aria-hidden="true" /><span class="sr-only">降雨機率</span>{weather.precipProb}%
        </span>
    {/if}
</div>
