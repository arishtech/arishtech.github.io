<?php 
$restly_ft1_top_group = restly_options('restly_ft1_top_groups');
if(!empty($restly_ft1_top_group)) :
?>
<div class="footer-top-area">
    <div class="container">
        <div class="row">
            <?php $coun = 0; foreach($restly_ft1_top_group as $restly_ft_top) : $coun++; ?>
            <div class="col-12 col-sm-6 col-md-4 col-lg-4 d-flex justify-content-<?php if($coun == 1) : ?>left<?php else : ?>center<?php endif; ?> ft-top-item">
                <div class="d-flex align-items-center">
                    <div class="ft2-icon">
                        <i class="<?php echo esc_attr($restly_ft_top['restly_ft1_top_icon']); ?>"></i>
                    </div>
                    <div class="ft2-content">
                        <label><?php echo esc_html($restly_ft_top['restly_ft1_top_label']); ?></label>
                        <?php echo wp_kses($restly_ft_top['restly_ft1_top_dec'],'restly_allowed_html'); ?>
                    </div>
                </div>
            </div>
            <?php endforeach; ?>
        </div>
    </div>
</div>
<?php endif; ?>