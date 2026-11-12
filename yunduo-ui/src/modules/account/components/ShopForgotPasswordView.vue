<!-- ShopForgotPasswordView：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import BrandMark from '@/shared/ui/BrandMark.vue'
import { ref, computed } from 'vue'
import { createShopForgotPasswordViewDemo } from '@/modules/account/demo/ShopForgotPasswordView'
const demo = createShopForgotPasswordViewDemo()
const __stub = notifyUnavailable
const i = ref(demo.i)
const isLoading = ref(demo.isLoading)
const disabled = ref(demo.disabled)
const phone = ref(demo.phone)
const rows = computed(() => demo.rows)
</script>

<template>
  <div class="forgot-page" data-v-8213c96a="">
    <div class="card" data-v-8213c96a="">
      <header class="card-head" data-v-8213c96a="">
        <BrandMark subtitle="找回密码" size="sm" data-v-8213c96a=""></BrandMark>
      </header>
      <section class="form-pane" data-v-8213c96a="">
        <h2 data-v-8213c96a="">找回登录密码</h2>
        <p class="hint" data-v-8213c96a="">通过手机验证码重置私域智能客服账号密码</p>
        <div class="steps" data-v-8213c96a="">
          <template :key="entryIndex" v-for="(item, entryIndex) in rows"
            ><i :class="['step-dot', { active: i === item, done: i > item }]" data-v-8213c96a=""></i
          ></template>
        </div>
        <template v-if="i === 1"
          ><div class="step-body" data-v-8213c96a="">
            <el-form label-position="top" @submit="__stub('此操作')" data-v-8213c96a=""
              ><el-form-item label="绑定手机号" data-v-8213c96a=""
                ><el-input
                  :model-value="phone?.['phone']"
                  @update:modelValue="__stub('此操作')"
                  maxlength="11"
                  placeholder="请输入注册手机号"
                  data-v-8213c96a=""
                ></el-input></el-form-item
              ><el-form-item label="验证码" data-v-8213c96a=""
                ><div class="code-row" data-v-8213c96a="">
                  <el-input
                    :model-value="phone?.['code']"
                    @update:modelValue="__stub('此操作')"
                    maxlength="6"
                    placeholder="请输入验证码"
                    data-v-8213c96a=""
                  ></el-input
                  ><el-button
                    :loading="isLoading"
                    :disabled="disabled > 0"
                    @click="__stub('此操作')"
                    data-v-8213c96a=""
                    >{{ disabled > 0 ? disabled + 's' : '获取验证码' }}</el-button
                  >
                </div></el-form-item
              ><el-button type="primary" class="block-btn" native-type="submit" data-v-8213c96a=""
                >下一步</el-button
              ></el-form
            >
          </div></template
        ><template v-else-if="i === 2"
          ><div class="step-body" data-v-8213c96a="">
            <el-form label-position="top" @submit="__stub('此操作')" data-v-8213c96a=""
              ><el-form-item label="新密码" data-v-8213c96a=""
                ><el-input
                  :model-value="phone?.['password']"
                  @update:modelValue="__stub('此操作')"
                  type="password"
                  show-password=""
                  placeholder="8-20 位，含字母与数字"
                  data-v-8213c96a=""
                ></el-input></el-form-item
              ><el-form-item label="确认新密码" data-v-8213c96a=""
                ><el-input
                  :model-value="phone?.['confirm']"
                  @update:modelValue="__stub('此操作')"
                  type="password"
                  show-password=""
                  placeholder="再次输入新密码"
                  data-v-8213c96a=""
                ></el-input
              ></el-form-item>
              <div class="btn-row" data-v-8213c96a="">
                <el-button @click="__stub('此操作')" data-v-8213c96a="">上一步</el-button
                ><el-button type="primary" native-type="submit" data-v-8213c96a=""
                  >下一步</el-button
                >
              </div></el-form
            >
          </div></template
        ><template v-else
          ><div class="step-body success" data-v-8213c96a="">
            <div class="ok" data-v-8213c96a="">✓</div>
            <h3 data-v-8213c96a="">密码已重置成功</h3>
            <p class="hint" data-v-8213c96a=""></p>
            <el-button type="primary" class="block-btn" @click="__stub('此操作')" data-v-8213c96a=""
              >返回登录</el-button
            >
          </div></template
        >
        <p class="footer" data-v-8213c96a="">
          想起密码了？
          <a href="javascript:void(0)" @click="__stub('此操作')" data-v-8213c96a="">返回登录</a>
        </p>
      </section>
    </div>
  </div>
</template>
